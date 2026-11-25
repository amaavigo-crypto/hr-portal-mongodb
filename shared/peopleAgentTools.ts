/**
 * People (employee lifecycle) agent: tool registry and the counting that must NOT be left to the model.
 * Pure code (no database, no network), tested in tests/peopleAgent.test.ts.
 *
 * Same pattern as the Leave agent (shared/leaveAgentTools.ts): read tools look things up; `propose` tools only create a
 * confirm card, and nothing changes until the person presses Confirm. Resigning or withdrawing a resignation is NOT
 * available here on purpose: it stays on the My exit screen.
 *
 * `access`:  all     every signed-in person (the route behind the tool already limits what comes back: own data,
 *                    a manager's team, or everyone for HR)
 *            manage  needs lifecycle.manage (or company admin)
 * This decides which tools the model is told about. It is not the security boundary: each tool calls the same People
 * route the screens use, with the person's own login, and that route checks company and permission again.
 */
import { hasPerm } from './permissions.js';
import { cleanText } from './leaveAgentTools.js';

export type PeopleToolAccess = 'all' | 'manage';

export interface PeopleAgentTool {
  name: string;
  kind: 'read' | 'propose';
  access: PeopleToolAccess;
  description: string;
  parameters: Record<string, any>;
}

const none = { type: 'object', properties: {}, additionalProperties: false };
const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const DATE = { type: 'string', description: 'YYYY-MM-DD' };

export const PEOPLE_AGENT_TOOLS: PeopleAgentTool[] = [
  {
    name: 'get_my_onboarding_tasks', kind: 'read', access: 'all',
    description: 'Onboarding and joining tasks that are this person\'s (and, for HR, tasks assigned to HR or IT for other joiners): title, who it is for, due date, status and how many are open or overdue. Each item has a taskId.',
    parameters: none,
  },
  {
    name: 'get_my_exit', kind: 'read', access: 'all',
    description: 'This person\'s own exit status: whether they have an exit case, its status, resignation date, last working day, notice required, notice served and any shortfall, and the no-dues clearance per department. Empty if they have none.',
    parameters: none,
  },
  {
    name: 'get_my_letters', kind: 'read', access: 'all',
    description: 'Letters HR has issued to this person (title, number, date). Does not return the letter text.',
    parameters: none,
  },
  {
    name: 'get_exits', kind: 'read', access: 'all',
    description: 'Exit cases this person can see: a manager sees their team\'s, HR sees everyone\'s. Per case: employee uid, name, department, status, resignation date, last working day, notice shortfall and how many clearance departments are done. Open cases first. Empty if this person manages nobody.',
    parameters: none,
  },
  {
    name: 'get_exit_details', kind: 'read', access: 'all',
    description: 'One exit case in full for a person this user may see: status, dates, notice, and every clearance department with its deptId, status, dues and owner. Needs the employee uid from get_exits.',
    parameters: obj({ uid: { type: 'string' } }, ['uid']),
  },
  {
    name: 'get_onboarding_overview', kind: 'read', access: 'manage',
    description: 'HR view of onboarding: per joiner the open and overdue task counts and join date, joiners with no checklist yet, and company totals.',
    parameters: none,
  },
  {
    name: 'propose_task_done', kind: 'propose', access: 'all',
    description: 'Prepares marking one onboarding task as done. Needs the taskId from get_my_onboarding_tasks and only works for an open task in that list. This only shows a confirm card; nothing changes until the person presses Confirm.',
    parameters: obj({ taskId: { type: 'string' }, note: { type: 'string' } }, ['taskId']),
  },
  {
    name: 'propose_exit_decision', kind: 'propose', access: 'all',
    description: 'Prepares approving or rejecting a resignation that is waiting for THIS person (a manager for their team, or HR). Needs the employee uid from get_exits. A rejection needs a reason that the person gave you. A manager\'s approval sends it on to HR; HR\'s approval accepts it. Optional lastWorkingDay (HR only) overrides the requested date. This only shows a confirm card; nothing is decided until the person presses Confirm.',
    parameters: obj({ uid: { type: 'string' }, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, note: { type: 'string' }, lastWorkingDay: DATE }, ['uid', 'decision']),
  },
  {
    name: 'propose_exit_clearance', kind: 'propose', access: 'all',
    description: 'Prepares recording one no-dues clearance department for someone serving notice: CLEARED, DUES (needs the amount owed and a note saying what for) or WAIVED (HR only). Needs the uid and the deptId from get_exit_details. Only the department owner or HR can do this. This only shows a confirm card; nothing changes until the person presses Confirm.',
    parameters: obj({
      uid: { type: 'string' }, deptId: { type: 'string' },
      status: { type: 'string', enum: ['CLEARED', 'DUES', 'WAIVED'] },
      dues: { type: 'number', description: 'Amount owed. Only with DUES.' }, note: { type: 'string' },
    }, ['uid', 'deptId', 'status']),
  },
];

export interface PeopleWho { perms?: string[] | null; isCompanyAdmin?: boolean }
export const canManagePeople = (w: PeopleWho) => !!w.isCompanyAdmin || hasPerm(w.perms, 'lifecycle.manage');
export const mayUsePeopleTool = (w: PeopleWho, t: Pick<PeopleAgentTool, 'access'>) => t.access === 'all' || canManagePeople(w);
export const peopleToolsFor = (w: PeopleWho): PeopleAgentTool[] => PEOPLE_AGENT_TOOLS.filter((t) => mayUsePeopleTool(w, t));

export function peopleRoleLine(w: PeopleWho): string {
  return canManagePeople(w)
    ? 'In the People area this person is HR (they run onboarding, exits and clearance for the whole company).'
    : 'In the People area this person can see their own onboarding tasks, exit and letters, and a manager also sees their team\'s exits.';
}

// ------------------------------------------------------------------ summaries (counted here, never by the model)

export interface TaskLike { id?: string; title?: string; status?: string; dueDate?: string; assignee?: string; kind?: string; forName?: string; own?: boolean }

export function summarizeTasks(tasks: TaskLike[], today: string, cap = 20) {
  const open = tasks.filter((t) => t.status === 'OPEN');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  return {
    total: tasks.length, open: open.length, overdue: overdue.length, done: tasks.filter((t) => t.status === 'DONE').length,
    tasks: [...open, ...tasks.filter((t) => t.status !== 'OPEN')].slice(0, cap).map((t) => ({
      taskId: t.id, title: cleanText(t.title, 120), forPerson: t.own ? 'you' : cleanText(t.forName, 80), dueDate: t.dueDate || null, overdue: !!(t.status === 'OPEN' && t.dueDate && t.dueDate < today),
      status: t.status, assignedTo: t.assignee,
    })),
  };
}

export interface ClearanceLike { deptId?: string; label?: string; status?: string; dues?: number; ownerName?: string; ownerUid?: string; note?: string }

export function summarizeClearance(items: ClearanceLike[]) {
  const done = items.filter((c) => c.status === 'CLEARED' || c.status === 'WAIVED').length;
  const withDues = items.filter((c) => c.status === 'DUES');
  const duesTotal = Math.round(withDues.reduce((n, c) => n + (Number(c.dues) || 0), 0) * 100) / 100;
  return {
    departments: items.length, cleared: done, pending: items.filter((c) => c.status === 'PENDING').length, withDues: withDues.length, duesTotal,
    items: items.map((c) => ({ deptId: c.deptId, department: cleanText(c.label, 80), status: c.status, dues: Number(c.dues) || 0, owner: cleanText(c.ownerName, 80), note: cleanText(c.note, 120) })),
  };
}

export interface ExitLike {
  status?: string; statusLabel?: string; resignationDate?: string; requestedLastDay?: string; lastWorkingDay?: string; noticeRequiredDays?: number; noticeServedDays?: number; noticeShortfallDays?: number;
  employee?: { uid?: string; name?: string; department?: string }; managerName?: string; clearance?: ClearanceLike[]; reason?: string;
}

export const exitIsOpen = (e: { status?: string }) => ['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED'].includes(String(e.status));

export function exitRow(e: ExitLike) {
  const c = summarizeClearance(e.clearance || []);
  return {
    uid: e.employee?.uid, employee: cleanText(e.employee?.name, 80), department: cleanText(e.employee?.department, 80), status: e.status, statusLabel: e.statusLabel,
    resignationDate: e.resignationDate, requestedLastDay: e.requestedLastDay, lastWorkingDay: e.lastWorkingDay || null,
    noticeRequiredDays: e.noticeRequiredDays, noticeShortfallDays: e.noticeShortfallDays, manager: cleanText(e.managerName, 80),
    clearance: e.status === 'APPROVED' ? { cleared: c.cleared, of: c.departments, withDues: c.withDues } : undefined,
  };
}

export function summarizeExits(list: ExitLike[], cap = 20) {
  const sorted = [...list].sort((a, b) => Number(exitIsOpen(b)) - Number(exitIsOpen(a)));
  const open = list.filter(exitIsOpen);
  return {
    total: list.length, open: open.length,
    waitingOnManager: open.filter((e) => e.status === 'SUBMITTED').length,
    waitingOnHr: open.filter((e) => e.status === 'MANAGER_APPROVED').length,
    inNotice: open.filter((e) => e.status === 'APPROVED').length,
    exits: sorted.slice(0, cap).map(exitRow),
  };
}

export interface JoinerRow { uid?: string; name?: string; empId?: string; department?: string; joinDate?: string; total?: number; open?: number; overdue?: number }

export function summarizeOnboarding(rows: JoinerRow[], without: { name?: string; joinDate?: string; uid?: string }[], cap = 15) {
  const withOpen = rows.filter((r) => (r.open || 0) > 0).sort((a, b) => (b.overdue || 0) - (a.overdue || 0) || (b.open || 0) - (a.open || 0) || String(a.name).localeCompare(String(b.name)));
  return {
    joinersWithChecklist: rows.length,
    joinersWithOpenTasks: withOpen.length,
    openTasks: rows.reduce((n, r) => n + (r.open || 0), 0),
    overdueTasks: rows.reduce((n, r) => n + (r.overdue || 0), 0),
    joiners: withOpen.slice(0, cap).map((r) => ({ uid: r.uid, name: cleanText(r.name, 80), department: cleanText(r.department, 60), joinDate: r.joinDate || null, open: r.open || 0, overdue: r.overdue || 0, total: r.total || 0 })),
    withoutChecklist: without.slice(0, 10).map((p) => ({ name: cleanText(p.name, 80), joinDate: p.joinDate || null })),
    withoutChecklistCount: without.length,
  };
}
