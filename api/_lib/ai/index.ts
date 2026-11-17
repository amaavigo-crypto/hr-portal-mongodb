/**
 * The shared AI layer. Every feature that uses a language model goes through here, so there is one place that decides
 * the model, retries, timeouts, the monthly limit, the cache, JSON checking and the usage and cost log.
 *
 *   aiJson({ cid, feature, system, user, schema })   -> { data } | { error } | { off }
 *   aiText({ cid, feature, system, user })           -> { text } | { error } | { off }
 *   aiChat({ cid, feature, messages, tools })        -> { message } | { error } | { off }   (the caller counts the question once)
 *
 * What it adds on top of a plain request:
 *  - one switch (OPENAI_API_KEY) and one model setting per feature (see provider.ts)
 *  - retries for busy or failing services (429, 5xx, network), never for a timeout or a bad request, inside a total time budget
 *  - a monthly call limit per company (AI_MONTHLY_CALLS, default 500) and an optional dollar budget (AI_MONTHLY_BUDGET_USD)
 *  - a cache keyed by the exact input, so the same resume or dashboard is never paid for twice
 *  - JSON replies are checked against a schema, with one repair attempt before giving up
 *  - a usage record per company per month (calls, tokens, estimated cost, by feature) and a small log row per call
 * With no key every call returns { off: true } and the caller falls back to its rule-based answer.
 */
import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { AiError, aiEnabled, aiKey, complete, modelFor, providerName, type Part } from './provider.js';
import { costMicros } from './pricing.js';
import { validate, type Schema } from './validate.js';

export { aiEnabled, aiKey, modelFor, type Part };
export { s, validate, type Schema } from './validate.js';

const USAGE_COLLECTION = 'hiringItems';
const LOG_COLLECTION = 'aiUsageLog';
const db = () => adminDb();
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const usageId = (cid: string) => `aiu_${cid}_${thisMonth()}`;

export const monthlyCap = (): number => {
  const n = Number(process.env.AI_MONTHLY_CALLS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
};
/** Optional spend limit per company per month, in US dollars. 0 or empty means no dollar limit. */
export const monthlyBudgetUsd = (): number => {
  const n = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface FeatureUsage { calls: number; inputTokens: number; outputTokens: number; costMicros: number }
export interface UsageSummary {
  month: string; used: number; cap: number; enabled: boolean;
  inputTokens: number; outputTokens: number; costMicros: number; failed: number; budgetUsd: number;
  byFeature: Record<string, FeatureUsage>;
}

export async function aiUsage(cid: string): Promise<UsageSummary> {
  const s = await db().collection(USAGE_COLLECTION).doc(usageId(cid)).get();
  const d: any = s.exists ? s.data() : {};
  return {
    month: thisMonth(), used: Number(d.calls || 0), cap: monthlyCap(), enabled: aiEnabled(),
    inputTokens: Number(d.inputTokens || 0), outputTokens: Number(d.outputTokens || 0), costMicros: Number(d.costMicros || 0),
    failed: Number(d.failed || 0), budgetUsd: monthlyBudgetUsd(), byFeature: (d.byFeature && typeof d.byFeature === 'object' ? d.byFeature : {}) as Record<string, FeatureUsage>,
  };
}

/** Reserves one call, or says why not. Done in a transaction so parallel requests cannot all slip under the limit. */
export async function reserveAiCall(cid: string): Promise<string> {
  const ref = db().collection(USAGE_COLLECTION).doc(usageId(cid));
  return db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const d: any = snap.exists ? snap.data() : {};
    const calls = Number(d.calls || 0);
    if (calls >= monthlyCap()) return `The monthly AI limit (${monthlyCap()} calls) has been reached. It resets next month, or an admin can raise AI_MONTHLY_CALLS.`;
    const budget = monthlyBudgetUsd();
    if (budget > 0 && Number(d.costMicros || 0) >= budget * 1_000_000) return `The monthly AI budget ($${budget}) has been reached. It resets next month, or an admin can raise AI_MONTHLY_BUDGET_USD.`;
    tx.set(ref, { ...d, id: ref.id, companyId: cid, kind: 'aiUsage', month: thisMonth(), calls: calls + 1, updatedAt: new Date().toISOString() });
    return '';
  });
}

async function release(cid: string): Promise<void> {
  const ref = db().collection(USAGE_COLLECTION).doc(usageId(cid));
  await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d: any = snap.data();
    tx.set(ref, { ...d, calls: Math.max(0, Number(d.calls || 0) - 1) });
  }).catch(() => undefined);
}

interface Spent { feature: string; model: string; inputTokens: number; outputTokens: number; ms: number; ok: boolean; error?: string; uid?: string; cached?: boolean }

/** Adds one call's tokens and cost to the company's monthly record and writes a log row. Never throws. */
async function record(cid: string, x: Spent): Promise<void> {
  try {
    const cost = costMicros(x.model, x.inputTokens, x.outputTokens);
    const ref = db().collection(USAGE_COLLECTION).doc(usageId(cid));
    await db().runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const d: any = snap.exists ? snap.data() : {};
      const by = { ...(d.byFeature || {}) };
      const f: FeatureUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, ...(by[x.feature] || {}) };
      f.calls += 1; f.inputTokens += x.inputTokens; f.outputTokens += x.outputTokens; f.costMicros += cost;
      by[x.feature] = f;
      tx.set(ref, {
        ...d, id: ref.id, companyId: cid, kind: 'aiUsage', month: thisMonth(),
        inputTokens: Number(d.inputTokens || 0) + x.inputTokens, outputTokens: Number(d.outputTokens || 0) + x.outputTokens,
        costMicros: Number(d.costMicros || 0) + cost, failed: Number(d.failed || 0) + (x.ok ? 0 : 1), byFeature: by, updatedAt: new Date().toISOString(),
      });
    });
    const log = db().collection(LOG_COLLECTION).doc();
    await log.set({
      id: log.id, companyId: cid, uid: x.uid || '', feature: x.feature, provider: providerName(), model: x.model, month: thisMonth(),
      inputTokens: x.inputTokens, outputTokens: x.outputTokens, costMicros: cost, ms: x.ms, ok: x.ok, error: x.error || '', at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('[ai] usage record failed:', e?.message || e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunOptions {
  cid: string; uid?: string; feature: string; messages: any[]; json?: boolean; tools?: any[];
  maxTokens?: number; temperature?: number; model?: string;
  /** Time allowed for one attempt (ms). */ timeoutMs?: number;
  /** Total time allowed including retries (ms). */ budgetMs?: number;
  /** Count this as one call against the monthly limit (default true). */ reserve?: boolean;
}
interface RunResult { message?: any; text?: string; error?: string; off?: boolean; inputTokens: number; outputTokens: number; model: string }

async function run(o: RunOptions): Promise<RunResult> {
  const model = (o.model || modelFor(o.feature)).trim();
  const none = { inputTokens: 0, outputTokens: 0, model };
  if (!aiEnabled()) return { off: true, ...none };
  const reserve = o.reserve !== false;
  if (reserve) {
    const limited = await reserveAiCall(o.cid);
    if (limited) return { error: limited, ...none };
  }
  const started = Date.now();
  const budget = o.budgetMs ?? 50_000;
  let lastError = 'The AI request failed.';
  let inT = 0;
  let outT = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = budget - (Date.now() - started);
    if (left < 2000) break;
    try {
      const r = await complete({
        model, messages: o.messages, json: o.json, tools: o.tools, maxTokens: o.maxTokens ?? 1200, temperature: o.temperature ?? 0.2,
        timeoutMs: Math.min(o.timeoutMs ?? 45_000, left),
      });
      inT += r.inputTokens; outT += r.outputTokens;
      await record(o.cid, { feature: o.feature, model, inputTokens: inT, outputTokens: outT, ms: Date.now() - started, ok: true, uid: o.uid });
      const text = typeof r.message.content === 'string' ? r.message.content.trim() : '';
      return { message: r.message, text, inputTokens: inT, outputTokens: outT, model };
    } catch (e: any) {
      lastError = e?.message || lastError;
      const retry = e instanceof AiError && e.retryable && attempt < 2;
      if (!retry) break;
      await sleep(Math.min(e.retryAfterMs || 0, 2000) || 400 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
  await record(o.cid, { feature: o.feature, model, inputTokens: inT, outputTokens: outT, ms: Date.now() - started, ok: false, error: lastError.slice(0, 200), uid: o.uid });
  if (reserve) await release(o.cid);
  return { error: lastError, inputTokens: inT, outputTokens: outT, model };
}

export interface AiResult<T = any> { data?: T; text?: string; message?: any; error?: string; off?: boolean; cached?: boolean; usage?: { input: number; output: number } }

const cacheDoc = (cid: string, feature: string, key: string) =>
  db().collection(USAGE_COLLECTION).doc(`aic_${createHash('sha256').update(`${cid}|${feature}|${key}`).digest('hex').slice(0, 40)}`);

export interface JsonOptions {
  cid: string; uid?: string; feature: string; system: string; user: string | Part[];
  schema?: Schema; cacheKey?: string; maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number; budgetMs?: number;
}

/** Asks for JSON, checks it against the schema, and tries once more with the problem pointed out if it does not fit. */
export async function aiJson<T = any>(o: JsonOptions): Promise<AiResult<T>> {
  if (!aiEnabled()) return { off: true };
  const cacheRef = o.cacheKey ? cacheDoc(o.cid, o.feature, o.cacheKey) : null;
  if (cacheRef) {
    const hit = await cacheRef.get();
    if (hit.exists && (hit.data() as any).companyId === o.cid) return { data: (hit.data() as any).result, cached: true };
  }
  const base = { cid: o.cid, uid: o.uid, feature: o.feature, json: true, maxTokens: o.maxTokens, temperature: o.temperature, model: o.model, timeoutMs: o.timeoutMs ?? 50_000, budgetMs: o.budgetMs };
  const messages: any[] = [{ role: 'system', content: o.system }, { role: 'user', content: o.user }];
  let res = await run({ ...base, messages });
  if (res.off || res.error) return res.off ? { off: true } : { error: res.error };

  let data: any;
  let problem = '';
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    problem = '';
    try { data = JSON.parse(res.text || ''); } catch { problem = 'it was not valid JSON'; }
    if (!problem && o.schema) {
      const c = validate(o.schema, data);
      if (c.ok === true) data = c.value; else problem = (c as { error: string }).error;
    }
    if (!problem) break;
    if (tryNo === 1) break;
    messages.push({ role: 'assistant', content: res.text || '' }, { role: 'user', content: `Your reply could not be used because ${problem}. Reply again with only the corrected JSON.` });
    res = await run({ ...base, messages, reserve: false });
    if (res.error) return { error: res.error };
  }
  if (problem) return { error: o.schema ? 'The AI returned an answer in the wrong shape. Try again.' : 'The AI returned an answer that could not be read. Try again.' };
  if (cacheRef) await cacheRef.set({ id: cacheRef.id, companyId: o.cid, kind: 'aiCache', feature: o.feature, result: data, at: new Date().toISOString() }).catch(() => undefined);
  return { data, usage: { input: res.inputTokens, output: res.outputTokens } };
}

export interface TextOptions {
  cid: string; uid?: string; feature: string; system: string; user: string; maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number; budgetMs?: number;
}

/** Plain text answer (a job description, a summary, a rewording). */
export async function aiText(o: TextOptions): Promise<AiResult> {
  const res = await run({ ...o, messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }] });
  if (res.off) return { off: true };
  if (res.error) return { error: res.error };
  if (!res.text) return { error: 'The AI sent an empty answer.' };
  return { text: res.text };
}

export interface ChatOptions {
  cid: string; uid?: string; feature: string; messages: any[]; tools?: any[]; maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number; budgetMs?: number;
  /** Chat rounds inside one question are not counted again; the caller reserves once with reserveAiCall. */ reserve?: boolean;
}

/** One round of a conversation, optionally with tools. Returns the model's message untouched. */
export async function aiChat(o: ChatOptions): Promise<AiResult> {
  const res = await run({ ...o, reserve: o.reserve === true });
  if (res.off) return { off: true };
  if (res.error) return { error: res.error };
  return { message: res.message };
}
