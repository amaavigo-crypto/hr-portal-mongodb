/**
 * Automatic follow-ups (reached through hiringRouter.ts as /api/recruitment/followup-<action>):
 *
 *   followup-state   settings, what would go out next, and what was sent lately
 *   followup-save    turn follow-ups (or one rule) on or off, or change its timing
 *   followup-run     send what is due now (still working hours only, still once a day)
 *   runFollowUpsAll  used by the daily job and, on a long-running server, every 30 minutes
 *
 * Off for every company until someone turns it on. Each reminder is claimed in a transaction under an id made from
 * (company, rule, work, person, day) BEFORE it is sent, so retries, two engines or two servers never send it twice.
 * Records live in hiringItems: kind followupSettings (one per company) and followupLog.
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getCompanyName, listApplications } from './recruitmentData.js';
import { MANAGE_PERMS, getItem, listItems, putItem, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { dispatchLiveEmail } from './serverEmail.js';
import {
  WORKING_HOURS_TEXT, cleanFollowUpSettings, defaultFollowUpSettings, dueEscalations, dueReminders, isWorkingTime, istDayOf,
  type Contact, type DueReminder, type FollowUpFacts, type FollowUpSettings,
} from '../../shared/followUps.js';

type Res = { status: number; json: any };
const db = () => adminDb();
const ok = (extra: Record<string, any> = {}): Res => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): Res => ({ status, json: { success: false, error } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The most reminders one company can send in one pass. Anything left goes in the next pass. */
export const MAX_PER_PASS = 50;

let nowFn = () => new Date();
export const __setFollowUpNow = (fn: (() => Date) | null) => { nowFn = fn || (() => new Date()); };
let mailer: typeof dispatchLiveEmail = dispatchLiveEmail;
export const __setFollowUpMailer = (fn: typeof dispatchLiveEmail | null) => { mailer = fn || dispatchLiveEmail; };

const canManage = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const settingsId = (cid: string) => `followup_settings_${cid}`;
const appUrl = () => (process.env.APP_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '');

export async function followUpSettings(cid: string): Promise<FollowUpSettings & { updatedBy?: string; updatedAt?: string }> {
  const it = await getItem(cid, settingsId(cid), 'followupSettings');
  return it ? { ...cleanFollowUpSettings(it, defaultFollowUpSettings()), updatedBy: it.updatedBy, updatedAt: it.updatedAt } : defaultFollowUpSettings();
}

interface Staff { uid: string; name: string; email: string; perms: string[]; roleIds: string[] }
async function staffOf(cid: string): Promise<Staff[]> {
  const snap = await db().collection('employees').where('companyId', '==', cid).get();
  return snap.docs.map((d: any) => d.data() as any).map((e: any, i: number) => ({ e, id: snap.docs[i].id }))
    .filter(({ e }: any) => e.active !== false)
    .map(({ e, id }: any) => ({ uid: String(e.authUid || id), name: String(e.name || ''), email: String(e.email || '').toLowerCase(), perms: Array.isArray(e.perms) ? e.perms : [], roleIds: Array.isArray(e.roleIds) ? e.roleIds : [] }));
}
const contact = (p: Staff): Contact => ({ email: p.email, name: p.name });
const headsOfHr = (cid: string, staff: Staff[]): Contact[] => {
  const heads = staff.filter((p) => p.roleIds.includes(`${cid}_hr-head`));
  return (heads.length ? heads : staff.filter((p) => p.roleIds.includes(`${cid}_company-admin`))).slice(0, 3).map(contact);
};

export async function gatherFollowUpFacts(cid: string): Promise<{ facts: FollowUpFacts; heads: Contact[] }> {
  const [staff, interviews, runs, tasks, offers, assessments, apps, reqSnap] = await Promise.all([
    staffOf(cid), listItems(cid, 'interview'), listItems(cid, 'flowRun'), listItems(cid, 'flowTask'), listItems(cid, 'offer'), listItems(cid, 'assessment'),
    listApplications(cid), db().collection('requisitions').where('companyId', '==', cid).get(),
  ]);
  const byUid = new Map(staff.map((p) => [p.uid, p]));
  const appById = new Map(apps.map((a) => [a.id, a]));
  const reqs = new Map<string, any>(reqSnap.docs.map((d: any) => [d.id, d.data()]));
  const heads = headsOfHr(cid, staff);
  const gone = (applicationId: string) => { const a = appById.get(applicationId); return !a || a.status === 'Rejected'; };
  const approvers = (() => {
    const all = staff.filter((p) => p.perms.includes('req.founder_decide'));
    const notAdmin = all.filter((p) => !p.roleIds.includes(`${cid}_company-admin`));
    return (notAdmin.length ? notAdmin : all).slice(0, 3).map(contact);
  })();

  const facts: FollowUpFacts = {
    interviews: interviews.filter((i) => i.status === 'SCHEDULED' && !gone(i.applicationId)).map((i) => ({
      id: i.id, applicationId: i.applicationId, candidateName: i.candidateName, round: i.round || 'interview', position: i.positionTitle || '', status: i.status,
      startIso: i.startIso, durationMinutes: i.durationMinutes,
      pending: (i.panel || []).filter((p: any) => !(i.scorecards || []).some((c: any) => c.interviewerId === p.uid) && byUid.has(p.uid)).map((p: any) => contact(byUid.get(p.uid)!)),
    })),
    waiting: runs.filter((r) => (r.status === 'WAITING' || r.status === 'STUCK') && !r.waitUntil && !gone(r.applicationId)).map((r) => {
      const task = tasks.find((x) => x.runId === r.id && x.stepId === r.stepId && x.status === 'OPEN');
      const owner = task ? byUid.get(task.ownerUid) : undefined;
      const req = reqs.get(appById.get(r.applicationId)?.requisitionId || '');
      const hrOwner = req?.ownerHr?.id ? byUid.get(req.ownerHr.id) : undefined;
      const who = owner || hrOwner;
      return {
        id: `${r.id}:${r.stepId}`, applicationId: r.applicationId, candidateName: r.candidateName, position: r.designation,
        stepTitle: String(task?.stepTitle || 'the current hiring step'), since: r.enteredAt, to: who ? [contact(who)] : heads.slice(0, 1),
      };
    }),
    offers: offers.filter((o) => o.status === 'PENDING_FOUNDER' && !gone(o.applicationId)).map((o) => ({
      id: o.id, applicationId: o.applicationId, candidateName: o.candidateName, position: o.designation || '',
      waitingSince: String([...(o.history || [])].reverse().find((h: any) => h.action === 'submit')?.at || o.updatedAt), to: approvers,
    })),
    tests: assessments.filter((x) => x.mode === 'AI_TEST' && x.status === 'ASSIGNED' && !x.startedAt && x.mailedAt && !gone(x.applicationId)).map((x) => {
      const a = appById.get(x.applicationId)!;
      return { id: x.id, applicationId: a.id, candidate: { email: a.email, name: a.name }, position: a.designation, expiresAt: String(x.expiresAt), link: appUrl() && x.token ? `${appUrl()}/?test=${x.token}` : '' };
    }),
  };
  return { facts, heads };
}

const logId = (cid: string, d: DueReminder, day: string) => `fulog_${createHash('sha256').update(`${cid}|${d.ruleId}|${d.targetKey}|${d.to.email.toLowerCase()}|${day}`).digest('hex').slice(0, 40)}`;

/** Everything due now that has not already gone to that person today. */
export async function planFollowUps(cid: string, settings: FollowUpSettings): Promise<{ pending: DueReminder[]; logs: Item[] }> {
  const now = nowFn();
  const day = istDayOf(now);
  const { facts, heads } = await gatherFollowUpFacts(cid);
  const company = await getCompanyName(cid);
  const logs = await listItems(cid, 'followupLog');
  const earlier = new Map<string, Set<string>>();
  for (const l of logs) if (l.status === 'SENT' && l.day < day) (earlier.get(l.targetKey) || earlier.set(l.targetKey, new Set()).get(l.targetKey)!).add(l.day);
  const due = dueReminders(facts, settings, now, company, appUrl());
  const all = [...due, ...dueEscalations(due, settings, new Map([...earlier].map(([k, v]) => [k, v.size])), heads, company)];
  const done = new Set(logs.map((l) => l.id));
  const seen = new Set<string>();
  const pending = all.filter((d) => {
    const id = logId(cid, d, day);
    if (!EMAIL_RE.test(d.to.email) || done.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { pending, logs };
}

export interface FollowUpPass { enabled: boolean; workingTime: boolean; sent: number; failed: number }

/** One pass for one company. Does nothing unless the company switched follow-ups on and it is working time. */
export async function runFollowUps(cid: string): Promise<FollowUpPass> {
  const settings = await followUpSettings(cid);
  const out: FollowUpPass = { enabled: settings.enabled, workingTime: isWorkingTime(nowFn()), sent: 0, failed: 0 };
  if (!settings.enabled || !out.workingTime) return out;
  const { pending } = await planFollowUps(cid, settings);
  const company = await getCompanyName(cid);
  for (const d of pending.slice(0, MAX_PER_PASS)) {
    // Pressing "Pause all" stops a pass that is already running.
    if (!(await followUpSettings(cid)).enabled) break;
    const day = istDayOf(nowFn());
    const ref = db().collection('hiringItems').doc(logId(cid, d, day));
    const entry: Item = { id: ref.id, companyId: cid, kind: 'followupLog', ruleId: d.ruleId, targetKey: d.targetKey, applicationId: d.applicationId, candidateName: d.candidateName, designation: d.position,
      toName: d.to.name, toEmail: d.to.email, why: d.why, subject: d.subject, day, at: nowFn().toISOString(), status: 'SENDING' };
    let mine = false;
    await db().runTransaction(async (tx: any) => { const snap = await tx.get(ref); if (snap.exists) { mine = false; return; } mine = true; tx.set(ref, clean(entry)); });
    if (!mine) continue;
    let error = '';
    try {
      const r = await mailer({ to: d.to.email, recipientName: d.to.name, fromName: company, subject: d.subject, body: d.body });
      if (!r.success) error = r.error || 'The email service did not accept the message.';
    } catch (e: any) { error = e?.message || 'The email could not be sent.'; }
    await putItem({ ...entry, status: error ? 'FAILED' : 'SENT', ...(error ? { error: error.slice(0, 300) } : {}) });
    if (error) out.failed++; else out.sent++;
  }
  return out;
}

export async function runFollowUpsAll(): Promise<Record<string, any>> {
  const out = { companies: 0, sent: 0, failed: 0 };
  if (!isWorkingTime(nowFn())) return out;
  const snap = await db().collection('hiringItems').where('kind', '==', 'followupSettings').get();
  for (const d of snap.docs) {
    const s = d.data() as Item;
    if (!s.enabled) continue;
    try {
      const co = await db().collection('companies').doc(s.companyId).get();
      if (!co.exists || co.get('status') !== 'ACTIVE') continue;
      const r = await runFollowUps(s.companyId);
      out.companies++; out.sent += r.sent; out.failed += r.failed;
    } catch (e: any) { console.warn('[FollowUps] pass failed:', e?.message || e); }
  }
  return out;
}

async function stateRoute(cid: string): Promise<Res> {
  const settings = await followUpSettings(cid);
  // "What would go out" uses the chosen rules even while the master switch is off, so people can look before turning it on.
  const { pending, logs } = await planFollowUps(cid, settings);
  const next = pending.slice(0, 20).map((d) => ({ ruleId: d.ruleId, candidateName: d.candidateName, toName: d.to.name || d.to.email, why: d.why, subject: d.subject, body: d.body }));
  const recent = logs.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20)
    .map((l) => ({ at: l.at, toName: l.toName || l.toEmail, candidateName: l.candidateName, why: l.why, status: l.status, error: l.error || '' }));
  return ok({ settings, next, waitingCount: pending.length, recent, workingHours: WORKING_HOURS_TEXT, workingTime: isWorkingTime(nowFn()) });
}

async function saveRoute(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const next = cleanFollowUpSettings(b, await followUpSettings(cid));
  await putItem({ id: settingsId(cid), companyId: cid, kind: 'followupSettings', enabled: next.enabled, rules: next.rules, updatedBy: await whoIs(ctx), updatedAt: new Date().toISOString() });
  return stateRoute(cid);
}

const ROUTES: Record<string, 'GET' | 'POST'> = { 'followup-state': 'GET', 'followup-save': 'POST', 'followup-run': 'POST' };

export async function routeFollowUps(r: PipeRequest): Promise<Res | null> {
  const method = ROUTES[r.action];
  if (!method) return null;
  try {
    if (r.method !== method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!canManage(ctx)) return fail(403, 'Only the people who manage hiring can change follow-ups.');
    if (r.action === 'followup-state') return await stateRoute(ctx.companyId);
    if (r.action === 'followup-save') return await saveRoute(ctx, r.body && typeof r.body === 'object' ? r.body : {});
    const pass = await runFollowUps(ctx.companyId);
    return ok({ ...pass });
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[FollowUps] error:', err);
    return fail(500, 'The follow-ups request failed.');
  }
}
