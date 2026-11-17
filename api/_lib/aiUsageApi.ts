/**
 * AI usage screens' data (under /api/tenant, so no extra Vercel function):
 *   GET ai-usage      company admin: this company's calls, limit and tokens for the month, by feature. No money amounts.
 *   GET ai-usage-all  platform admin: every company's usage for the month, including estimated cost.
 */
import { adminDb } from './firebaseAdmin.js';
import { requireActiveTenant, requirePlatformAdmin, AuthError } from './authContext.js';
import { aiUsage, monthlyBudgetUsd, type UsageSummary } from './ai/index.js';

type Result = { status: number; json: any };
const money = (micros: number) => Math.round(micros / 1000) / 1000; // dollars with 3 decimals

function publicView(u: UsageSummary, withCost: boolean) {
  const by = Object.entries(u.byFeature).map(([feature, f]) => ({
    feature, calls: f.calls, inputTokens: f.inputTokens, outputTokens: f.outputTokens, ...(withCost ? { costUsd: money(f.costMicros) } : {}),
  })).sort((a, b) => b.calls - a.calls);
  return {
    month: u.month, enabled: u.enabled, used: u.used, cap: u.cap, failed: u.failed,
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, byFeature: by,
    ...(withCost ? { costUsd: money(u.costMicros), budgetUsd: u.budgetUsd } : {}),
  };
}

export async function companyAiUsage(headers: Record<string, any>): Promise<Result> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.isCompanyAdmin) throw new AuthError(403, 'Only a company admin can see AI usage.');
  return { status: 200, json: { success: true, usage: publicView(await aiUsage(ctx.companyId!), false) } };
}

export async function allAiUsage(headers: Record<string, any>): Promise<Result> {
  await requirePlatformAdmin(headers);
  const snap = await adminDb().collection('hiringItems').where('kind', '==', 'aiUsage').get();
  const rows = [];
  for (const d of snap.docs) {
    const x: any = d.data();
    if (!x.companyId) continue;
    const comp = await adminDb().collection('companies').doc(String(x.companyId)).get().catch(() => null);
    rows.push({ companyId: x.companyId, company: (comp && comp.exists && (comp.data() as any).name) || String(x.companyId), month: x.month, calls: Number(x.calls || 0), failed: Number(x.failed || 0), inputTokens: Number(x.inputTokens || 0), outputTokens: Number(x.outputTokens || 0), costUsd: money(Number(x.costMicros || 0)) });
  }
  rows.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : b.costUsd - a.costUsd));
  return { status: 200, json: { success: true, rows, budgetUsd: monthlyBudgetUsd() } };
}
