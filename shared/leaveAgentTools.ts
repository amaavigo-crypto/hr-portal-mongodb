/**
 * Leave & Attendance agent: the tool registry and the number-crunching that must NOT be left to the model.
 * Pure code (no database, no network) so it is tested on its own (tests/leaveAgent.test.ts).
 *
 * Read tools look things up. Proposal tools (kind 'propose') never change a record either: they only create a
 * proposal that the person confirms with a separate click on a card (see api/_lib/assistantApi.ts, `confirm`).
 * The card's wording is built by the server from the real record, never from what the model says.
 *
 * `access` decides which tools the model is even told about for this person:
 *   all     every signed-in employee. The route behind the tool already limits the data to what that person may see
 *           (own data for an employee, their team for a manager, everyone for HR).
 *   report  needs leave.report or leave.manage (or company admin)
 *   manage  needs leave.manage (or company admin)
 * This is NOT the security boundary. Each tool calls the same leave route the screens use, with the person's own
 * login, and that route checks company and permission again.
 */
import { hasPerm } from './permissions.js';

export type LeaveToolAccess = 'all' | 'report' | 'manage';

export interface LeaveAgentTool {
  name: string;
  kind: 'read' | 'propose';
  access: LeaveToolAccess;
  description: string;
  parameters: Record<string, any>;
}

const none = { type: 'object', properties: {}, additionalProperties: false };
const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const DATE = { type: 'string', description: 'YYYY-MM-DD' };

export const LEAVE_AGENT_TOOLS: LeaveAgentTool[] = [
  {
    name: 'get_pending_approvals', kind: 'read', access: 'all',
    description: 'Leave requests and attendance corrections waiting for a decision from THIS person (a manager sees their team, HR sees everyone). Each item: who, leave type, dates, days, how long it has waited and whether it is overdue. Empty if this person approves nobody.',
    parameters: none,
  },
  {
    name: 'get_team_calendar', kind: 'read', access: 'all',
    description: 'Who is on leave (approved or pending) in a date range, plus holidays. A manager sees their team, HR sees everyone, an employee sees their own team. Range is at most 31 days; without dates it covers today and the next 14 days.',
    parameters: obj({ from: DATE, to: DATE }),
  },
  {
    name: 'get_attendance_summary', kind: 'read', access: 'all',
    description: 'Attendance counts (present, late, absent, half day, on leave, incomplete) per person for the people this person may see, for a range of at most 31 days, with the people who have the most late or absent days. Without dates it covers the last 7 days. Optional uid narrows it to one person (from find_employee).',
    parameters: obj({ from: DATE, to: DATE, uid: { type: 'string', description: 'Optional: one employee uid from find_employee.' } }),
  },
  {
    name: 'get_leave_exceptions', kind: 'read', access: 'report',
    description: 'Open leave and attendance exceptions and flags that HR needs to look at, most severe first, with the total number open.',
    parameters: none,
  },
  {
    name: 'get_leave_requests_overview', kind: 'read', access: 'report',
    description: 'Company-wide leave requests for a date range, with counts per status and the most recent requests. Optional filters: status (PENDING, APPROVED, REJECTED, WITHDRAWN, CANCELLED, INFO_REQUESTED), uid, from, to.',
    parameters: obj({ status: { type: 'string' }, uid: { type: 'string' }, from: DATE, to: DATE }),
  },
  {
    name: 'find_employee', kind: 'read', access: 'manage',
    description: 'Finds employees by name, employee id, email or department. Returns uid, name, employee id, department and title. Use it first when another tool needs a person\'s uid.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'get_employee_leave_ledger', kind: 'read', access: 'manage',
    description: 'The most recent leave balance entries (credits, usage, adjustments) for one employee. Needs the uid from find_employee.',
    parameters: obj({ uid: { type: 'string' } }, ['uid']),
  },
  {
    name: 'propose_leave_decision', kind: 'propose', access: 'all',
    description: 'Prepares approving or rejecting one leave request (or a cancellation request) that is waiting for THIS person. Needs the requestId from get_pending_approvals. A rejection needs a reason that the person gave you. This only shows a confirm card; nothing is decided until the person presses Confirm.',
    parameters: obj({ requestId: { type: 'string' }, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, comment: { type: 'string', description: 'Reason or note. Required for REJECT.' } }, ['requestId', 'decision']),
  },
  {
    name: 'propose_attendance_decision', kind: 'propose', access: 'all',
    description: 'Prepares approving or rejecting one attendance correction that is waiting for THIS person. Needs the correctionId from get_pending_approvals. A rejection needs a reason that the person gave you. This only shows a confirm card; nothing is decided until the person presses Confirm.',
    parameters: obj({ correctionId: { type: 'string' }, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, comment: { type: 'string', description: 'Reason or note. Required for REJECT.' } }, ['correctionId', 'decision']),
  },
  {
    name: 'propose_apply_leave', kind: 'propose', access: 'all',
    description: 'Prepares a leave application for the signed-in person themselves (never for someone else). The server checks the dates, notice and balance and works out the days. This only shows a confirm card; nothing is sent until the person presses Confirm. Use only when the person clearly asked to apply and gave the leave type and dates; ask for what is missing first.',
    parameters: obj({
      leaveType: { type: 'string', description: 'Leave type name or code as shown by get_leave_balances, e.g. Casual leave or CL.' },
      from: DATE, to: { type: 'string', description: 'YYYY-MM-DD. Same as from for a single day.' },
      halfDay: { type: 'string', enum: ['none', 'first_half', 'second_half'], description: 'Only for a single day.' },
      reason: { type: 'string' },
    }, ['leaveType', 'from']),
  },
];

export interface AgentWho { perms?: string[] | null; isCompanyAdmin?: boolean }

export const canManageLeave = (w: AgentWho) => !!w.isCompanyAdmin || hasPerm(w.perms, 'leave.manage');
export const canReportLeave = (w: AgentWho) => canManageLeave(w) || hasPerm(w.perms, 'leave.report');

export function mayUseTool(w: AgentWho, t: Pick<LeaveAgentTool, 'access'>): boolean {
  return t.access === 'all' || (t.access === 'report' ? canReportLeave(w) : canManageLeave(w));
}

/** The tools this person's permissions unlock. */
export const toolsFor = (w: AgentWho): LeaveAgentTool[] => LEAVE_AGENT_TOOLS.filter((t) => mayUseTool(w, t));

/** One short line for the prompt, so the model knows what kind of person it is talking to. */
export function roleLine(w: AgentWho): string {
  if (canManageLeave(w)) return 'This person is HR (they manage leave and attendance for the whole company).';
  if (canReportLeave(w)) return 'This person can view leave and attendance reports for the whole company but cannot change anything.';
  return 'This person is an employee or manager. Questions about approvals and the team apply only if they manage a team; the tools return nothing otherwise.';
}

// ------------------------------------------------------------------ argument cleaning

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * A date range from model-supplied arguments. Bad or missing dates fall back to the default window; a range longer
 * than `maxDays` is cut short (never longer), and `to` is never before `from`.
 */
export function cleanRange(from: unknown, to: unknown, today: string, fallbackDays: number, maxDays = 31, defaultStart = today): { from: string; to: string; cut: boolean } {
  const f = isIsoDate(from) ? from : isIsoDate(to) && !isIsoDate(from) ? addDays(to, -(fallbackDays - 1)) : defaultStart;
  let t = isIsoDate(to) ? to : addDays(f, fallbackDays - 1);
  if (t < f) t = f;
  let cut = false;
  if (daysBetween(f, t) + 1 > maxDays) { t = addDays(f, maxDays - 1); cut = true; }
  return { from: f, to: t, cut };
}

/** An id the model passes back (uid). Only plain id characters, so it cannot smuggle anything else into a query. */
export const cleanUid = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return /^[A-Za-z0-9_\-:.@]{1,128}$/.test(s) ? s : '';
};

export const cleanText = (v: unknown, max = 200): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ------------------------------------------------------------------ summaries (counted here, never by the model)

export interface DayRec { date: string; status: string; late?: boolean }
export interface PersonDays { uid: string; name: string; empId?: string; department?: string; days: DayRec[] }

const COUNTED: Record<string, string> = { PRESENT: 'present', LATE: 'present', HALF_DAY: 'halfDay', HALF_LEAVE: 'halfDay', LEAVE: 'onLeave', ABSENT: 'absent', INCOMPLETE: 'incomplete' };

export interface AttendanceCounts { present: number; late: number; halfDay: number; onLeave: number; absent: number; incomplete: number }
const zero = (): AttendanceCounts => ({ present: 0, late: 0, halfDay: 0, onLeave: 0, absent: 0, incomplete: 0 });

export function countDays(days: DayRec[]): AttendanceCounts {
  const c = zero();
  for (const d of days) {
    const k = COUNTED[d.status];
    if (k) (c as any)[k] += 1;
    if (d.late || d.status === 'LATE') c.late += 1;
  }
  return c;
}

export function summarizeAttendance(people: PersonDays[], top = 5, maxPeople = 40) {
  const rows = people.map((p) => ({ name: p.name, empId: p.empId || '', department: p.department || '', ...countDays(p.days) }));
  const total = zero();
  for (const r of rows) for (const k of Object.keys(total) as (keyof AttendanceCounts)[]) total[k] += r[k];
  const most = (key: 'late' | 'absent') => rows.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, top).map((r) => ({ name: r.name, department: r.department, days: r[key] }));
  return {
    peopleCount: rows.length,
    totals: total,
    mostLate: most('late'),
    mostAbsent: most('absent'),
    people: rows.length <= maxPeople ? rows : undefined,
    note: rows.length > maxPeople ? `Showing totals and the top ${top} only; ${rows.length} people are in scope.` : undefined,
  };
}

export function countBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) { const k = key(i) || 'UNKNOWN'; out[k] = (out[k] || 0) + 1; }
  return out;
}

/** Case-insensitive match on name, employee id, email or department. */
export function matchEmployees<T extends { name?: string; empId?: string; email?: string; department?: string }>(list: T[], query: string, limit = 8): T[] {
  const q = cleanText(query, 80).toLowerCase();
  if (q.length < 2) return [];
  const parts = q.split(' ').filter(Boolean);
  return list
    .map((p) => {
      const hay = [p.name, p.empId, p.email, p.department].map((x) => String(x || '').toLowerCase());
      const all = parts.every((w) => hay.some((h) => h.includes(w)));
      const exact = hay[0] === q || hay[1] === q || hay[2] === q;
      return { p, score: exact ? 3 : hay[0].startsWith(q) ? 2 : all ? 1 : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.p.name).localeCompare(String(b.p.name)))
    .slice(0, limit)
    .map((x) => x.p);
}

// ------------------------------------------------------------------ proposals (the confirm cards)

export type ProposalAction = 'leave_decision' | 'regularization_decision' | 'apply_leave' | 'task_done' | 'exit_decision' | 'exit_clearance';
export const PROPOSAL_TTL_MS = 30 * 60_000;

/** What the panel shows. Built by the server from the real record. */
export interface ProposalCard {
  id: string;
  action: ProposalAction;
  title: string;
  lines: string[];
  confirmLabel: string;
  /** Rejections and the like get a red button. */
  destructive?: boolean;
}

export const proposalLive = (p: { status?: string; expiresAt?: string }, now = Date.now()): boolean =>
  p.status === 'PENDING' && !!p.expiresAt && Date.parse(p.expiresAt) > now;

export const dateSpan = (from: string, to: string) => (from === to ? from : `${from} to ${to}`);
export const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Finds the leave type the person meant by code or name. Null when nothing, or more than one thing, fits. */
export function matchLeaveType<T extends { name?: string; code?: string }>(types: T[], query: unknown): T | null {
  const q = cleanText(query, 60).toLowerCase();
  if (!q) return null;
  const exact = types.filter((t) => String(t.code || '').toLowerCase() === q || String(t.name || '').toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const loose = types.filter((t) => String(t.name || '').toLowerCase().includes(q) || q.includes(String(t.name || '').toLowerCase()));
  return loose.length === 1 ? loose[0] : null;
}
