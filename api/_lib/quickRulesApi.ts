/**
 * Quick rules (reached through hiringRouter.ts as /api/recruitment/qrule-<action>):
 *
 *   qrule-list / qrule-save / qrule-switch / qrule-delete
 *   qrule-test       dry run on recent applications: nothing is sent or changed
 *   quickRulesHook   called when an application arrives (and when its resume is read)
 *
 * Safety: a rule is a draft until someone turns it on; it only sees applications that arrive after that; it runs at most
 * once per candidate (claimed in a transaction before anything happens); it cannot reject or move anyone; every run is
 * recorded; and a company sends at most DAILY_EMAIL_LIMIT rule emails a day.
 * Records live in hiringItems: kind quickRule and quickRun.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, getCompanyName, listApplications, type ApplicationDoc } from './recruitmentData.js';
import { MANAGE_PERMS, getItem, listItems, newId, putItem, requisitionForApplication, scoreFor, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { MAX_RULES, cleanRule, describeAction, fill, matches, type RuleAction, type RuleFacts } from '../../shared/quickRules.js';

type Res = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ok = (extra: Record<string, any> = {}): Res => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): Res => ({ status, json: { success: false, error } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DAILY_EMAIL_LIMIT = 300;

let mailer: typeof dispatchLiveEmail = dispatchLiveEmail;
export const __setRuleMailer = (fn: typeof dispatchLiveEmail | null) => { mailer = fn || dispatchLiveEmail; };

const canManage = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));

async function staffOf(cid: string) {
  const snap = await db().collection('employees').where('companyId', '==', cid).get();
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).filter((e: any) => e.active !== false)
    .map((e: any) => ({ uid: String(e.authUid || e.id), name: String(e.name || e.email || ''), email: String(e.email || ''), roleIds: (e.roleIds || []) as string[] }));
}

async function factsFor(cid: string, a: ApplicationDoc, needsScore: boolean): Promise<RuleFacts> {
  const years = a.totalExperienceYears ?? (() => { const m = String(a.experience || '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; })();
  let score: number | null = null;
  if (needsScore && (await listItems(cid, 'resume')).some((r) => r.applicationId === a.id)) {
    const s: any = await scoreFor(cid, a);
    // The share of the job's key skills that the resume mentions: the one part of the score a resume can answer by itself.
    const v = s?.score?.lines?.find((l: any) => l.part === 'skills')?.rating;
    score = typeof v === 'number' ? v : null;
  }
  return { job: a.designation, experience: years ?? null, source: String((a as any).sourceLabel || a.source || ''), city: a.city || '', score };
}

async function emailsToday(cid: string): Promise<number> {
  const day = nowIso().slice(0, 10);
  return (await listItems(cid, 'quickRun')).filter((r) => String(r.at).startsWith(day)).reduce((n, r) => n + Number(r.emails || 0), 0);
}

async function perform(cid: string, a: ApplicationDoc, action: RuleAction, company: string): Promise<{ text: string; ok: boolean; emails: number }> {
  if (action.type === 'tag') {
    const ref = db().collection('applications').doc(a.id);
    await db().runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const tags: string[] = Array.isArray(snap.get('tags')) ? snap.get('tags') : [];
      if (!tags.includes(action.tag)) tx.set(ref, { ...snap.data(), tags: [...tags, action.tag] });
    });
    return { text: `Added the tag "${action.tag}".`, ok: true, emails: 0 };
  }
  if ((await emailsToday(cid)) >= DAILY_EMAIL_LIMIT) return { text: 'Email not sent: the daily limit for rule emails was reached.', ok: false, emails: 0 };
  let to: { email: string; name: string };
  let subject: string;
  let body: string;
  if (action.type === 'ack') {
    const v = { name: a.name, job: a.designation, company };
    to = { email: a.email, name: a.name }; subject = fill(action.subject, v); body = fill(action.message, v);
  } else {
    const staff = await staffOf(cid);
    const req: any = await requisitionForApplication(cid, a);
    const person = staff.find((p) => p.uid === action.uid) || staff.find((p) => p.uid === req?.ownerHr?.id) || staff.find((p) => p.roleIds.includes(`${cid}_hr-head`)) || staff.find((p) => p.roleIds.includes(`${cid}_company-admin`));
    if (!person) return { text: 'Nobody to tell: choose a person in the rule.', ok: false, emails: 0 };
    to = person; subject = `New applicant to look at: ${a.name} (${a.designation})`;
    body = `Hi ${person.name},\n\n${a.name} applied for ${a.designation} and matched one of your quick rules. Open Hiring > Candidates to look.\n\n${company}`;
  }
  if (!EMAIL_RE.test(to.email || '')) return { text: `Email not sent: ${to.name || 'the person'} has no valid email address.`, ok: false, emails: 0 };
  try {
    const r = await mailer({ to: to.email, recipientName: to.name, fromName: company, subject, body });
    return r.success ? { text: `Emailed ${to.name}.`, ok: true, emails: 1 } : { text: `Email to ${to.name} failed: ${r.error || 'not accepted'}.`, ok: false, emails: 0 };
  } catch (e: any) { return { text: `Email to ${to.name} failed: ${e?.message || 'error'}.`, ok: false, emails: 0 }; }
}

/** Runs every rule that is on against one application. Never throws: an application must always be saved. */
export async function quickRulesHook(cid: string, applicationId: string): Promise<void> {
  try {
    const rules = (await listItems(cid, 'quickRule')).filter((r) => r.status === 'ON').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (!rules.length) return;
    const a = await getApplication(cid, applicationId);
    // Imported spreadsheets are old records, not new applications.
    if (!a || a.source === 'CSV' || a.status === 'Rejected') return;
    const company = await getCompanyName(cid);
    for (const rule of rules) {
      if (String(a.receivedAt || a.createdAt) < String(rule.activatedAt || '')) continue;
      const facts = await factsFor(cid, a, rule.conditions.some((c: any) => c.field === 'score'));
      if (matches(rule.conditions, facts) !== true) continue;   // null: no score yet, looked at again when the resume is read
      const ref = db().collection('hiringItems').doc(`qrun_${rule.id}_${a.id}`);
      const run: Item = { id: ref.id, companyId: cid, kind: 'quickRun', ruleId: rule.id, ruleName: rule.name, applicationId: a.id, candidateName: a.name, designation: a.designation, at: nowIso(), results: [], emails: 0, ok: true };
      let mine = false;
      await db().runTransaction(async (tx: any) => { const snap = await tx.get(ref); if (snap.exists) { mine = false; return; } mine = true; tx.set(ref, run); });
      if (!mine) continue;
      for (const action of rule.actions as RuleAction[]) {
        const r = await perform(cid, a, action, company);
        run.results.push(r.text); run.emails += r.emails; run.ok = run.ok && r.ok;
        await putItem(run);
      }
    }
  } catch (e: any) { console.warn('[QuickRules] hook failed:', e?.message || e); }
}

async function listRoute(cid: string): Promise<Res> {
  const [rules, runs, staff] = await Promise.all([listItems(cid, 'quickRule'), listItems(cid, 'quickRun'), staffOf(cid)]);
  const count = (id: string) => runs.filter((r) => r.ruleId === id).length;
  return ok({
    rules: rules.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((r) => ({ id: r.id, name: r.name, status: r.status, conditions: r.conditions, actions: r.actions, updatedBy: r.updatedBy, runs: count(r.id) })),
    people: staff.map((p) => ({ uid: p.uid, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    recent: runs.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15).map((r) => ({ at: r.at, ruleName: r.ruleName, candidateName: r.candidateName, results: r.results, ok: r.ok })),
  });
}

async function saveRoute(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const { value, error } = cleanRule(b);
  if (!value) return fail(400, error!);
  const staff = await staffOf(cid);
  for (const a of value.actions) if (a.type === 'notify' && a.uid && !staff.some((p) => p.uid === a.uid)) return fail(400, 'Choose an active person from your company.');
  const prev = b.id ? await getItem(cid, str(b.id), 'quickRule') : null;
  if (b.id && !prev) return fail(404, 'Rule not found.');
  if (!prev && (await listItems(cid, 'quickRule')).length >= MAX_RULES) return fail(409, `A company can have up to ${MAX_RULES} rules.`);
  const on = b.turnOn === true;
  const it: Item = {
    id: prev?.id || newId(), companyId: cid, kind: 'quickRule', ...value, status: on ? 'ON' : 'DRAFT',
    activatedAt: on ? (prev?.status === 'ON' ? prev.activatedAt : nowIso()) : '', createdAt: prev?.createdAt || nowIso(), updatedAt: nowIso(), updatedBy: await whoIs(ctx),
  };
  await putItem(it);
  return ok({ id: it.id, status: it.status });
}

async function switchRoute(ctx: AuthContext, b: any): Promise<Res> {
  const prev = await getItem(ctx.companyId!, str(b.id), 'quickRule');
  if (!prev) return fail(404, 'Rule not found.');
  const on = b.on === true;
  await putItem({ ...prev, status: on ? 'ON' : 'OFF', activatedAt: on ? nowIso() : '', updatedAt: nowIso(), updatedBy: await whoIs(ctx) });
  return ok({});
}

async function testRoute(cid: string, b: any): Promise<Res> {
  const { value, error } = cleanRule({ ...b, name: b?.name || 'Test' });
  if (!value) return fail(400, error!);
  const apps = (await listApplications(cid)).filter((a) => a.status !== 'Rejected').slice(0, 50);
  const needsScore = value.conditions.some((c) => c.field === 'score');
  const staff = await staffOf(cid);
  const hits: { candidateName: string; designation: string }[] = [];
  let unknown = 0;
  for (const a of apps) {
    const m = matches(value.conditions, await factsFor(cid, a, needsScore));
    if (m === null) unknown++;
    else if (m) hits.push({ candidateName: a.name, designation: a.designation });
  }
  return ok({ checked: apps.length, matched: hits.length, unknown, examples: hits.slice(0, 10), wouldDo: value.actions.map((x) => describeAction(x, x.type === 'notify' ? staff.find((p) => p.uid === x.uid)?.name : undefined)) });
}

const ROUTES: Record<string, 'GET' | 'POST'> = { 'qrule-list': 'GET', 'qrule-save': 'POST', 'qrule-switch': 'POST', 'qrule-delete': 'POST', 'qrule-test': 'POST' };

export async function routeQuickRules(r: PipeRequest): Promise<Res | null> {
  const method = ROUTES[r.action];
  if (!method) return null;
  try {
    if (r.method !== method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!canManage(ctx)) return fail(403, 'Only the people who manage hiring can change quick rules.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (r.action === 'qrule-list') return await listRoute(ctx.companyId);
    if (r.action === 'qrule-save') return await saveRoute(ctx, b);
    if (r.action === 'qrule-switch') return await switchRoute(ctx, b);
    if (r.action === 'qrule-test') return await testRoute(ctx.companyId, b);
    const it = await getItem(ctx.companyId, str(b.id), 'quickRule');
    if (!it) return fail(404, 'Rule not found.');
    await db().collection('hiringItems').doc(it.id).delete();
    return ok({});
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[QuickRules] error:', err);
    return fail(500, 'The quick rules request failed.');
  }
}
