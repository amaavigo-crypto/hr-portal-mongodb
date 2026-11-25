/**
 * The daily watcher: who gets nudged about what. Pure code (no database, no network, no AI), so it is tested on its own
 * (tests/agentWatcher.test.ts). api/_lib/agentWatcher.ts feeds it the records and delivers what it returns.
 *
 *   Managers   leave requests waiting on them for more than 2 days
 *   HR         open attendance exceptions, exit clearance that is running out of time, overdue onboarding tasks
 *   HR         also: identity documents waiting for review for more than 3 days, and employee records still incomplete 14 days after joining
 *   Documents  HR: versions waiting for review 3+ days, policies due for review, low acknowledgement a week after publishing;
 *             everyone: policies they have had to acknowledge for a week or more
 *   Wellbeing  people who can view Wellbeing results get one Monday line when few people have opted in or nobody has played lately
 *             (never sent to the players themselves: playing is voluntary)
 *   Everyone   their own overdue onboarding tasks and identity documents HR did not approve (never "you have nothing on file": missing details go to HR)
 *
 * One digest per person. A person who is a manager and HR and has a task gets one message with three sections. People with
 * nothing to look at get nothing. The model is never involved: the counts and the wording come from here.
 */
import { addDays, dateSpan, dayWord, daysBetween } from './leaveAgentTools.js';
import { wellbeingNudge, type WellbeingWatch } from './wellbeingAgentTools.js';
import { type DocumentWatch } from './documentAgentTools.js';

/** A leave request is "stuck" once it has waited longer than this many days. */
export const WATCH_WAIT_DAYS = 2;
/** Clearance counts as running out of time when the last working day is this close, or already past. */
export const WATCH_EXIT_WINDOW_DAYS = 7;
export const WATCH_MAX_LINES = 6;
/** An identity document waiting for HR is nudged once it has waited longer than this many days. */
export const WATCH_DOC_WAIT_DAYS = 3;
/** A new joiner gets this many days to fill in their record before anyone is nudged about gaps. */
export const WATCH_PROFILE_GRACE_DAYS = 14;
/** Exception categories that are about attendance (late marks, missing check-outs, leave next to a check-in). */
export const ATTENDANCE_CATEGORIES = ['ATTENDANCE_MISMATCH', 'FLAG_LATE'];

export interface WatchLeave { name: string; typeName: string; from: string; to: string; createdDay: string; /** MANAGER, HR ... */ stage: string; managerUid: string }
export interface WatchException { category: string; employee: string; message: string; severity: string; createdDay: string }
export interface WatchExit { name: string; lastWorkingDay: string; pendingDepts: string[] }
export interface WatchTask { title: string; forUid: string; forName: string; assigneeUid: string; assignee: string; dueDate: string }
export interface WatchRecord {
  uid: string; name: string; joinDate: string;
  /** Labels of what is missing (PAN, Aadhaar, Mobile number...). */
  missing: string[];
  rejected: { document: string; reason: string }[];
  pending: { document: string; submittedDay: string }[];
}
export interface WatchInput {
  today: string;
  people: { uid: string; name: string; email: string }[];
  hrUids: string[];
  leaves: WatchLeave[];
  exceptions: WatchException[];
  exits: WatchExit[];
  /** Open tasks only. Overdue is decided here. */
  tasks: WatchTask[];
  /** Employee records. Optional so older callers keep working. */
  records?: WatchRecord[];
  /** Document governance. Optional. */
  documents?: DocumentWatch | undefined;
  /** Wellbeing programme health, for the people who can view Wellbeing results. Optional. */
  wellbeing?: (WellbeingWatch & { viewerUids: string[] }) | undefined;
}

export interface DigestSection { heading: string; lines: string[] }
export interface Digest { uid: string; name: string; email: string; sections: DigestSection[]; count: number; title: string; short: string }

const cap = (lines: string[], max = WATCH_MAX_LINES) => (lines.length > max ? [...lines.slice(0, max), `and ${lines.length - max} more`] : lines);
const cut = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const SEVERITY: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const isOverdueTask = (t: Pick<WatchTask, 'dueDate'>, today: string) => !!t.dueDate && t.dueDate < today;

export function buildDigests(inp: WatchInput): Digest[] {
  const { today } = inp;
  const hr = new Set(inp.hrUids);
  const sections = new Map<string, DigestSection[]>();
  const add = (uid: string, s: DigestSection) => { if (uid && s.lines.length) sections.set(uid, [...(sections.get(uid) || []), s]); };

  // Managers: leave requests that have waited on them for more than WATCH_WAIT_DAYS days.
  const byManager = new Map<string, (WatchLeave & { waiting: number })[]>();
  for (const l of inp.leaves) {
    const waiting = daysBetween(l.createdDay, today);
    if (l.stage !== 'MANAGER' || !l.managerUid || waiting <= WATCH_WAIT_DAYS) continue;
    byManager.set(l.managerUid, [...(byManager.get(l.managerUid) || []), { ...l, waiting }]);
  }
  for (const [uid, list] of byManager) {
    list.sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name));
    add(uid, { heading: `Leave ${plural(list.length, 'request', 'requests')} waiting for your decision (${list.length})`, lines: cap(list.map((l) => `${l.name}: ${l.typeName}, ${dateSpan(l.from, l.to)}, waiting ${dayWord(l.waiting)}`)) });
  }

  // HR: the company-wide picture.
  const attendance = inp.exceptions
    .filter((e) => ATTENDANCE_CATEGORIES.includes(e.category))
    .sort((a, b) => (SEVERITY[a.severity] ?? 3) - (SEVERITY[b.severity] ?? 3) || a.createdDay.localeCompare(b.createdDay));
  const exits = inp.exits
    .filter((e) => e.pendingDepts.length > 0 && e.lastWorkingDay <= addDays(today, WATCH_EXIT_WINDOW_DAYS))
    .sort((a, b) => a.lastWorkingDay.localeCompare(b.lastWorkingDay) || a.name.localeCompare(b.name));
  const overdue = inp.tasks.filter((t) => isOverdueTask(t, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.forName.localeCompare(b.forName));
  for (const uid of hr) {
    add(uid, { heading: `Open attendance ${plural(attendance.length, 'exception', 'exceptions')} (${attendance.length})`, lines: cap(attendance.map((e) => `${e.employee ? `${e.employee}: ` : ''}${cut(e.message, 110)}`)) });
    add(uid, { heading: `Exit clearance running out of time (${exits.length})`, lines: cap(exits.map((e) => `${e.name}: last working day ${e.lastWorkingDay}${e.lastWorkingDay < today ? ' (passed)' : ''}, still pending: ${e.pendingDepts.join(', ')}`)) });
    add(uid, { heading: `Overdue onboarding ${plural(overdue.length, 'task', 'tasks')} (${overdue.length})`, lines: cap(overdue.map((t) => `${t.forName}: ${t.title}, due ${t.dueDate}`)) });
  }

  // HR: identity documents that have waited too long, and records that are still incomplete after the grace period.
  const records = inp.records || [];
  const stuckDocs = records.flatMap((r) => r.pending.map((d) => ({ name: r.name, document: d.document, waiting: d.submittedDay ? daysBetween(d.submittedDay, today) : 0 })))
    .filter((d) => d.waiting > WATCH_DOC_WAIT_DAYS).sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name));
  const incomplete = records.filter((r) => r.missing.length > 0 && r.joinDate && daysBetween(r.joinDate, today) >= WATCH_PROFILE_GRACE_DAYS)
    .sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
  for (const uid of hr) {
    add(uid, { heading: `Identity ${plural(stuckDocs.length, 'document', 'documents')} waiting for your review (${stuckDocs.length})`, lines: cap(stuckDocs.map((d) => `${d.name}: ${d.document}, waiting ${dayWord(d.waiting)}`)) });
    add(uid, { heading: `Incomplete employee ${plural(incomplete.length, 'record', 'records')} (${incomplete.length})`, lines: cap(incomplete.map((r) => `${r.name}: missing ${r.missing.join(', ')}`)) });
  }
  // Documents: HR sees the pipeline; each person sees their own pending acknowledgements.
  const dw = inp.documents;
  if (dw) {
    for (const uid of hr) {
      add(uid, { heading: `Document ${plural(dw.reviewWaiting.length, 'version', 'versions')} waiting for review (${dw.reviewWaiting.length})`, lines: cap(dw.reviewWaiting.map((d) => `${d.document} v${d.version}, created ${dayWord(d.days)} ago`)) });
      add(uid, { heading: `${plural(dw.reviewDue.length, 'Policy', 'Policies')} due for review (${dw.reviewDue.length})`, lines: cap(dw.reviewDue.map((d) => `${d.document} v${d.version}: ${d.days < 0 ? `overdue by ${dayWord(-d.days)}` : d.days === 0 ? 'due today' : `due in ${dayWord(d.days)}`}`)) });
      add(uid, { heading: `Low acknowledgement (${dw.lowAcknowledged.length})`, lines: cap(dw.lowAcknowledged.map((d) => `${d.document} v${d.version}: ${d.percent}% acknowledged, ${d.pending} pending`)) });
    }
    const mine = new Map<string, typeof dw.pendingAcks>();
    for (const a of dw.pendingAcks) mine.set(a.uid, [...(mine.get(a.uid) || []), a]);
    for (const [uid, list] of mine) add(uid, { heading: `${plural(list.length, 'Policy', 'Policies')} to acknowledge (${list.length})`, lines: cap(list.map((a) => `${a.document} v${a.version}, waiting ${dayWord(a.days)}`)) });
  }
  // Wellbeing: only people who can view its results, only on Mondays, and only about the programme (never about a person).
  const wb = wellbeingNudge(inp.wellbeing, today);
  if (wb) for (const uid of inp.wellbeing!.viewerUids) add(uid, { heading: 'Wellbeing games (1)', lines: [wb] });
  // Everyone: their own documents that need attention.
  for (const r of records) {
    const lines = r.rejected.map((d) => `${d.document} was not approved${d.reason ? `: ${cut(d.reason, 80)}` : ''}. Please submit it again`);
    add(r.uid, { heading: `Your ${plural(lines.length, 'document needs', 'documents need')} attention (${lines.length})`, lines: cap(lines) });
  }

  // Everyone else: tasks that are theirs to do. HR already sees every overdue task above.
  for (const p of inp.people) {
    if (hr.has(p.uid)) continue;
    const mine = overdue.filter((t) => t.assigneeUid === p.uid || (t.assignee === 'EMPLOYEE' && t.forUid === p.uid));
    add(p.uid, { heading: `Your overdue onboarding ${plural(mine.length, 'task', 'tasks')} (${mine.length})`, lines: cap(mine.map((t) => `${t.title}${t.forUid !== p.uid ? ` (for ${t.forName})` : ''}, due ${t.dueDate}`)) });
  }

  const out: Digest[] = [];
  const known = new Map(inp.people.map((p) => [p.uid, p]));
  for (const [uid, list] of sections) {
    const p = known.get(uid);
    if (!p) continue; // inactive or unknown people are not messaged
    const count = list.reduce((n, s) => n + Number((/\((\d+)\)$/.exec(s.heading) || [])[1] || 0), 0);
    out.push({
      uid, name: p.name, email: p.email, sections: list, count,
      title: `Ask HR: ${count} ${plural(count, 'thing needs', 'things need')} your attention`,
      short: cut(list.map((s) => s.heading).join('. '), 380),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The email text. Plain, short, and says where to act. */
export function emailBody(d: Digest, company: string, link = ''): string {
  return [
    `Good morning ${d.name.split(' ')[0] || ''}`.trim() + ',',
    '',
    `Here is what is waiting at ${company} today:`,
    ...d.sections.flatMap((s) => ['', s.heading, ...s.lines.map((l) => `- ${l}`)]),
    '',
    `Open the portal and ask Ask HR to help with any of these.${link ? ` ${link}` : ''}`,
  ].join('\n');
}
