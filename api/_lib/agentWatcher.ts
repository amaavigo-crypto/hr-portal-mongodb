/**
 * Daily watcher for Ask HR: the agent speaks first. Runs once a day from cronjob.org (`GET /api/assistant/daily`, protected by
 * CRON_SECRET like the other daily jobs). Who is told what is decided in shared/agentWatcher.ts; this file reads the records
 * and delivers.
 *
 *  - It only reads company data and sends messages. It never changes a record and never calls the AI model, so it costs nothing.
 *  - One digest per person per day: an in-app notification (the bell), an email, and a copy in `agentWatchLog` that the Ask HR
 *    panel shows when the person opens it. Running it twice in a day sends nothing twice.
 *  - HR means the people whose email is in the Leave setup "notify emails" list (the same rule the leave escalations use).
 *  - `?dry=1` returns what would be sent without sending or saving anything.
 */
import { adminDb } from './firebaseAdmin.js';
import { companyLabel, companyRequests, inApp, loadPeople, loadSettings, notify } from './leaveCore.js';
import { buildDigests, emailBody, type Digest, type WatchInput } from '../../shared/agentWatcher.js';
import { addDays } from '../../shared/leaveAgentTools.js';
import { istDay, str, type Result } from './agentKit.js';
import { peopleRows } from './lifecycleApi.js';
import { GAP_LABEL, gapsOf, identityList, type PersonRow } from '../../shared/employeeAgentTools.js';

const db = () => adminDb();
export const WATCH_LOG = 'agentWatchLog';
const logId = (cid: string, uid: string, day: string) => `${cid}__${uid}__${day}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);

/** Reads what the watcher needs for one company. */
export async function gatherWatchInput(cid: string, today: string): Promise<WatchInput> {
  const [{ settings }, everyone, requests, exSnap, exitSnap, taskSnap, recordRows] = await Promise.all([
    loadSettings(cid), loadPeople(cid), companyRequests(cid),
    db().collection('leaveExceptions').where('companyId', '==', cid).where('status', '==', 'OPEN').get(),
    db().collection('lifecycleExits').where('companyId', '==', cid).where('status', '==', 'APPROVED').get(),
    db().collection('lifecycleTasks').where('companyId', '==', cid).where('status', '==', 'OPEN').get(),
    peopleRows(cid).catch((): PersonRow[] => []),
  ]);
  const people = everyone.filter((p) => p.active);
  const by = new Map(everyone.map((p) => [p.uid, p]));
  const notifyList = new Set((settings.notifyEmails || []).map((e) => e.trim().toLowerCase()));
  return {
    today,
    people: people.map((p) => ({ uid: p.uid, name: p.name, email: p.email })),
    hrUids: people.filter((p) => notifyList.has(p.email)).map((p) => p.uid),
    leaves: requests.filter((r) => r.status === 'PENDING').map((r) => ({
      name: r.name, typeName: r.typeName, from: r.from, to: r.to, createdDay: String(r.createdAt || '').slice(0, 10) || today,
      stage: String(r.steps?.[r.stepIndex]?.role || ''), managerUid: r.managerUid || '',
    })),
    exceptions: exSnap.docs.map((d: any) => d.data() as any).map((e: any) => ({
      category: String(e.category || ''), employee: String(e.flag?.name || by.get(e.uid)?.name || ''), message: String(e.message || ''),
      severity: String(e.severity || 'MEDIUM'), createdDay: String(e.createdAt || '').slice(0, 10) || today,
    })),
    exits: exitSnap.docs.map((d: any) => d.data() as any).map((e: any) => ({
      name: by.get(e.uid)?.name || 'Employee', lastWorkingDay: String(e.lastWorkingDay || ''),
      pendingDepts: (Array.isArray(e.clearance) ? e.clearance : []).filter((c: any) => c.status === 'PENDING').map((c: any) => String(c.label || c.deptId || 'Department')),
    })).filter((e: any) => e.lastWorkingDay),
    records: recordRows.map((r) => {
      const g = gapsOf(r);
      const ids = identityList(r);
      return {
        uid: r.uid, name: r.name, joinDate: r.joinDate, missing: g.map((x) => GAP_LABEL[x]),
        rejected: ids.filter((d) => d.status === 'not approved').map((d) => ({ document: d.document, reason: d.hrReason || '' })),
        pending: Object.entries(r.identity).filter(([, i]) => i.status === 'PENDING').map(([t, i]) => ({ document: ids.find((d) => d.type === t)?.document || t, submittedDay: i.pendingSince || '' })),
      };
    }),
    // A checklist for someone who has already left is not worth a message.
    tasks: taskSnap.docs.map((d: any) => d.data() as any).filter((t: any) => people.some((p) => p.uid === String(t.uid))).map((t: any) => ({
      title: String(t.title || 'Task'), forUid: String(t.uid || ''), forName: by.get(String(t.uid))?.name || 'New joiner',
      assigneeUid: String(t.assigneeUid || ''), assignee: String(t.assignee || ''), dueDate: String(t.dueDate || ''),
    })),
  };
}

export interface WatchSummary { people: number; sent: number; alreadySent: number; preview?: { to: string; title: string; sections: Digest['sections'] }[] }

export async function runWatcher(cid: string, opts: { dry?: boolean; today?: string } = {}): Promise<WatchSummary> {
  const today = opts.today || istDay();
  const digests = buildDigests(await gatherWatchInput(cid, today));
  if (opts.dry) return { people: digests.length, sent: 0, alreadySent: 0, preview: digests.map((d) => ({ to: d.email || d.name, title: d.title, sections: d.sections })) };
  const company = digests.length ? await companyLabel(cid) : '';
  const link = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  let sent = 0;
  let alreadySent = 0;
  for (const d of digests) {
    const ref = db().collection(WATCH_LOG).doc(logId(cid, d.uid, today));
    if ((await ref.get()).exists) { alreadySent++; continue; }
    // The log entry goes first: if anything after it fails, the person is not messaged twice by a rerun.
    await ref.set({ companyId: cid, uid: d.uid, date: today, title: d.title, short: d.short, sections: d.sections, count: d.count, seen: false, createdAt: new Date().toISOString() });
    await inApp(cid, [d.uid], d.title, d.short, '', `WATCH_${today}`).catch(() => undefined);
    if (d.email) await notify(cid, [d.email], d.title, emailBody(d, company, link));
    sent++;
  }
  return { people: digests.length, sent, alreadySent };
}

/** The cron entry point: every active company, one failure never stops the rest. */
export async function runWatcherAll(opts: { dry?: boolean } = {}): Promise<Result> {
  const snap = await db().collection('companies').where('status', '==', 'ACTIVE').get();
  const results: Record<string, any> = {};
  for (const d of snap.docs) {
    try { results[d.id] = await runWatcher(d.id, opts); } catch (e: any) { results[d.id] = { error: str(e?.message, 200) || 'failed' }; }
  }
  return { status: 200, json: { success: true, dry: !!opts.dry, companies: snap.size, results } };
}

/** The newest digest for this person from today or yesterday that they have not dismissed, for the Ask HR panel. */
export async function latestNudge(cid: string, uid: string, today = istDay()): Promise<Result> {
  const snap = await db().collection(WATCH_LOG).where('companyId', '==', cid).where('uid', '==', uid).get();
  const d = snap.docs.map((x: any) => ({ id: x.id, ...(x.data() as any) }))
    .filter((x: any) => x.date >= addDays(today, -1) && !x.seen)
    .sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
  return { status: 200, json: { success: true, nudge: d ? { id: d.id, date: d.date, title: d.title, count: d.count, sections: d.sections } : null } };
}

export async function markNudgeSeen(cid: string, uid: string, id: string): Promise<Result> {
  const ref = db().collection(WATCH_LOG).doc(str(id, 200) || 'none');
  const s = await ref.get();
  const d: any = s.exists ? s.data() : null;
  if (!d || d.companyId !== cid || d.uid !== uid) return { status: 404, json: { success: false, error: 'Not found.' } };
  await ref.update({ seen: true });
  return { status: 200, json: { success: true } };
}
