/**
 * The daily reminder email: policies to acknowledge, expense claims waiting too long for an approver, and policies due for review.
 * One email per person per day. Each item is remembered (reminderLog) so running the job twice sends nothing twice,
 * and the timing comes from shared/reminderRules.ts, the same rules the Home page uses.
 */
import { db, inApp, loadPeople, loadProfiles, loadSettings, notify, nowIso, type Person } from './leaveCore.js';
import { RULES, ackDue, claimDue, digest, reviewDue, type ReminderItem } from '../../shared/reminderRules.js';
import { istToday } from '../../shared/leaveEngine.js';
import { sendTeamWeeklySummaries } from './teamWeekApi.js';

const logId = (cid: string, uid: string, key: string) => `${cid}__${uid}__${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
const day = (v: unknown) => String(v || '').slice(0, 10);

interface Pending extends ReminderItem { uid: string; test: (last?: string) => boolean }

/** Everything that could be reminded today, with who it is for. Nothing is sent here. */
export async function collectReminders(cid: string, today: string): Promise<{ items: Pending[]; people: Person[] }> {
  const [people, profiles, settings] = await Promise.all([loadPeople(cid), loadProfiles(cid), loadSettings(cid)]);
  const active = people.filter((p) => p.active && p.email);
  const byAny = new Map<string, Person>();
  for (const p of active) { byAny.set(p.uid, p); byAny.set(p.docId, p); }
  const hr = active.filter((p) => settings.settings.notifyEmails.includes(p.email.toLowerCase()));
  const items: Pending[] = [];

  const [versions, acks, claims, docs] = await Promise.all([
    db().collection('versions').where('companyId', '==', cid).where('status', '==', 'PUBLISHED').get(),
    db().collection('acknowledgments').where('companyId', '==', cid).where('status', '==', 'PENDING').get(),
    db().collection('payrollClaims').where('companyId', '==', cid).where('status', '==', 'SUBMITTED').get(),
    db().collection('documents').where('companyId', '==', cid).get(),
  ]);
  const live = new Map<string, any>(versions.docs.map((d: any) => [d.id, d.data()]));
  const retired = new Set(docs.docs.filter((d: any) => d.get('active') === false).map((d: any) => d.id));

  for (const d of acks.docs) {
    const a: any = d.data();
    if (a.documentVersionId && !live.has(String(a.documentVersionId))) continue; // an older version's record
    const who = byAny.get(String(a.employeeId));
    if (!who) continue;
    const created = String(a.createdAt || '');
    items.push({ key: `ack:${d.id}`, kind: 'ACK', uid: who.uid, text: `${a.documentTitle || 'A policy'}${a.versionNumber ? ` (version ${a.versionNumber})` : ''}`, test: (last) => ackDue(created, today, last) });
  }

  for (const d of claims.docs) {
    const c: any = d.data();
    const claimant = byAny.get(String(c.uid));
    const mgr = byAny.get(String(profiles.get(String(c.uid))?.managerUid || ''));
    const to = mgr && mgr.uid !== c.uid ? [mgr] : hr.filter((p) => p.uid !== c.uid);
    const created = String(c.createdAt || '');
    for (const p of to) items.push({ key: `claim:${d.id}`, kind: 'CLAIM', uid: p.uid, text: `${claimant?.name || 'Someone'}: ${c.category || 'claim'}, Rs ${Number(c.amount) || 0}`, test: (last) => claimDue(created, today, last) });
  }

  for (const [id, v] of live) {
    if (!v.reviewDueDate || retired.has(String(v.documentMasterId))) continue;
    const due = day(v.reviewDueDate);
    const owner = byAny.get(String(v.createdById || ''));
    const to = owner ? [owner] : hr;
    for (const p of to) items.push({ key: `review:${id}`, kind: 'REVIEW', uid: p.uid, text: `${v.documentTitle || 'A policy'} (review date ${due})`, test: (last) => reviewDue(due, today, last) });
  }
  return { items, people: active };
}

/** Sends today's reminders for one company. Safe to run twice. */
export async function runReminders(cid: string, today: string = istToday()): Promise<{ people: number; items: number; emails: number }> {
  if (process.env.REMINDERS_OFF === '1') return { people: 0, items: 0, emails: 0 };
  const { items, people } = await collectReminders(cid, today);
  const mine = new Map<string, Pending[]>();
  for (const i of items) mine.set(i.uid, [...(mine.get(i.uid) || []), i]);
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  let emails = 0, sent = 0;
  for (const [uid, list] of mine) {
    const person = people.find((p) => p.uid === uid);
    if (!person) continue;
    const due: Pending[] = [];
    for (const i of list) {
      const rec = await db().collection('reminderLog').doc(logId(cid, uid, i.key)).get();
      if (i.test(rec.exists ? String(rec.get('lastSent') || '') : undefined)) due.push(i);
    }
    if (!due.length) continue;
    const mail = digest(person.name, due, base);
    await notify(cid, [person.email], mail.subject, mail.body);
    await inApp(cid, [uid], mail.subject, `${due.length} item(s) are waiting. Check your Home page.`, '', `REMINDERS_${today}`).catch(() => undefined);
    for (const i of due) await db().collection('reminderLog').doc(logId(cid, uid, i.key)).set({ companyId: cid, uid, key: i.key, lastSent: today, at: nowIso() });
    emails++; sent += due.length;
  }
  return { people: mine.size, items: sent, emails };
}

/** Every active company, for the daily job. One company failing does not stop the others. */
export async function runAllReminders(today: string = istToday()): Promise<Record<string, any>> {
  const snap = await db().collection('companies').where('status', '==', 'ACTIVE').get();
  const out: Record<string, any> = {};
  for (const d of snap.docs) {
    try {
      out[d.id] = { ...(await runReminders(d.id, today)), teamWeek: await sendTeamWeeklySummaries(d.id, today).catch((e: any) => ({ error: e?.message || 'failed' })) };
    } catch (e: any) { out[d.id] = { error: e?.message || 'failed' }; }
  }
  return out;
}
export { RULES };
