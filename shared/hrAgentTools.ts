/**
 * HR Agent tool registry (shared by the server and the tests).
 *
 * The HR Agent is an assistant for HR people only. It can look things up in the Leave and attendance, Hiring,
 * Onboarding and lifecycle, and Policy and performance areas. In this first phase every tool is read-only: nothing here
 * can change a record. Write tools (approve leave, move a candidate, send a reminder ...) arrive in later phases and
 * will only ever create a proposal that the person confirms with a separate click.
 *
 * `requires` lists the permissions that unlock a tool (any one of them; company admins always pass). It decides which
 * tools the model is even told about. It is not the security boundary: each tool then calls the same module route the
 * screens use, with the person's own login, and that route checks permission and company again.
 */
import { hasPerm } from './permissions.js';

export type AgentModule = 'leave' | 'hiring' | 'lifecycle' | 'policy';

export interface AgentTool {
  name: string;
  module: AgentModule;
  kind: 'read';
  description: string;
  parameters: Record<string, any>;
  requires: string[];
}

const none = { type: 'object', properties: {}, additionalProperties: false };
const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const LEAVE = ['leave.manage', 'leave.report'];
const HIRING = ['app.manage', 'req.manage_jd', 'req.hr_decide'];

export const AGENT_TOOLS: AgentTool[] = [
  // ---- Leave and attendance
  { name: 'find_employee', module: 'leave', kind: 'read', requires: ['leave.manage'],
    description: 'Finds employees by name, employee id, email or department. Returns uid, name, employee id, department and title. Use it first when you need a person\'s uid for another tool.',
    parameters: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'get_pending_leave_requests', module: 'leave', kind: 'read', requires: LEAVE,
    description: 'Leave requests that are waiting for a decision: who, leave type, dates, days, how long they have waited and who the manager is.', parameters: none },
  { name: 'get_pending_regularizations', module: 'leave', kind: 'read', requires: LEAVE,
    description: 'Attendance corrections (regularizations) still waiting for a decision: who, date, times, reason and days waiting.', parameters: none },
  { name: 'get_leave_exceptions', module: 'leave', kind: 'read', requires: LEAVE,
    description: 'Open leave and attendance exceptions and flags that HR needs to look at, most severe first.', parameters: none },
  { name: 'get_attendance_summary', module: 'leave', kind: 'read', requires: LEAVE,
    description: 'Attendance counts (present, late, absent, half day, on leave, incomplete) per person for a date range of at most 31 days, plus the people with the most late or absent days. Dates are YYYY-MM-DD. Without dates it covers the last 7 days.',
    parameters: obj({ from: { type: 'string' }, to: { type: 'string' }, uid: { type: 'string', description: 'Optional: one employee uid from find_employee.' } }) },
  { name: 'get_leave_ledger', module: 'leave', kind: 'read', requires: ['leave.manage'],
    description: 'The recent leave balance entries (credits, usage, adjustments) for one employee. Needs the uid from find_employee.',
    parameters: obj({ uid: { type: 'string' } }, ['uid']) },
  // ---- Hiring pipeline
  { name: 'get_hiring_pipeline', module: 'hiring', kind: 'read', requires: HIRING,
    description: 'Candidates in the hiring pipeline with status, designation, screening outcome, pending assessments and next interview, plus counts per status. Optional filters: designation, status.',
    parameters: obj({ designation: { type: 'string' }, status: { type: 'string' } }) },
  { name: 'get_candidate_detail', module: 'hiring', kind: 'read', requires: HIRING,
    description: 'One candidate\'s stage, screening, assessments and interviews. Needs the candidate id from get_hiring_pipeline.',
    parameters: obj({ applicationId: { type: 'string' } }, ['applicationId']) },
  // ---- Onboarding and lifecycle
  { name: 'get_onboarding_status', module: 'lifecycle', kind: 'read', requires: ['lifecycle.manage', 'onboarding.manage'],
    description: 'Onboarding checklists: for each new joiner the open and overdue task counts, plus active employees who have no checklist yet.', parameters: none },
  { name: 'get_exits', module: 'lifecycle', kind: 'read', requires: ['lifecycle.manage'],
    description: 'Resignations and exits: who, status, last working day, open ones first.', parameters: none },
  // ---- Policy and performance
  { name: 'get_pending_acknowledgments', module: 'policy', kind: 'read', requires: ['compliance.view'],
    description: 'Policy acknowledgments employees still owe for currently published policy versions: per employee the policies pending, and per policy how many are pending.', parameters: none },
  { name: 'get_performance_todo', module: 'policy', kind: 'read', requires: ['pm.manage'],
    description: 'Performance items waiting for HR and managers: reviews to open or approve, overdue self-reviews, disputed reviews, check-ins and plan follow-ups.', parameters: none },
];

export const TOOL_BY_NAME: Record<string, AgentTool> = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

const may = (t: AgentTool, perms: string[], isAdmin: boolean) => isAdmin || t.requires.some((p) => hasPerm(perms, p));

/** The tools this person may use. */
export function toolsFor(perms: string[] | undefined | null, isAdmin: boolean): AgentTool[] {
  const p = perms || [];
  return AGENT_TOOLS.filter((t) => may(t, p, isAdmin));
}

/** Whether the HR Agent panel is offered at all: the person holds at least one agent tool's permission. */
export function canUseHrAgent(perms: string[] | undefined | null, isAdmin: boolean): boolean {
  return toolsFor(perms, isAdmin).length > 0;
}

/** True when this person may run this tool. Checked again on the server for every call the model makes. */
export function mayRunTool(name: string, perms: string[] | undefined | null, isAdmin: boolean): boolean {
  const t = TOOL_BY_NAME[name];
  return !!t && may(t, perms || [], isAdmin);
}

/** The shape the chat API wants for the model. */
export const asModelTools = (list: AgentTool[]) => list.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

// ------------------------------------------------------------------ argument cleaning (the model's arguments are never trusted)

export const cleanText = (v: unknown, max = 200): string => (v === undefined || v === null || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max));
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const cleanId = (v: unknown): string => { const s = cleanText(v, 128); return /^[A-Za-z0-9_.@-]{1,128}$/.test(s) ? s : ''; };

/** Adds days to a YYYY-MM-DD date (calendar arithmetic in UTC, so no time zone shift). */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const MAX_RANGE_DAYS = 31;

/** A safe date range: valid, from <= to, at most 31 days. Defaults to the last 7 days ending today. */
export function cleanRange(from: unknown, to: unknown, today: string): { from: string; to: string } | { error: string } {
  const t = isIsoDate(to) ? to : today;
  const f = isIsoDate(from) ? from : addDaysIso(t, -6);
  if (f > t) return { error: 'The start date is after the end date.' };
  const span = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000) + 1;
  if (span > MAX_RANGE_DAYS) return { error: `Choose a range of at most ${MAX_RANGE_DAYS} days.` };
  return { from: f, to: t };
}

/** Counts attendance day statuses for one person's days. */
export function countDays(days: { status?: string; late?: boolean }[]): Record<string, number> {
  const out: Record<string, number> = { present: 0, late: 0, absent: 0, halfDay: 0, onLeave: 0, incomplete: 0 };
  for (const d of days) {
    switch (d.status) {
      case 'PRESENT': out.present++; break;
      case 'LATE': out.late++; break;
      case 'ABSENT': out.absent++; break;
      case 'HALF_DAY': case 'HALF_LEAVE': out.halfDay++; break;
      case 'LEAVE': out.onLeave++; break;
      case 'INCOMPLETE': out.incomplete++; break;
      default: break;
    }
  }
  return out;
}
