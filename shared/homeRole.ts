/**
 * Which kind of Home a person gets, and what is on it.
 *
 * Pure TypeScript (no browser or Node imports) so the browser builds Home with it and the tests can check, for each kind of
 * person, the card order and the quick actions. This only decides ORDER and WHICH shortcuts; it never grants access. Every card
 * still asks the server, and a card the person may not see is simply empty and hidden.
 */
import { hasAnyPerm } from './permissions.js';
import type { WidgetTarget } from './dashboard.js';

export type HomeRole = 'ADMIN' | 'HR' | 'FOUNDER' | 'MANAGER' | 'EMPLOYEE';

export interface HomeRoleInput {
  perms: string[] | undefined | null;
  isAdmin: boolean;
  /** Manages people (has direct reports, covers for a manager, or may approve for HR). Comes from the "approvals" dashboard widget. */
  isManager: boolean;
}

const HR_PERMS = ['leave.manage', 'lifecycle.manage', 'req.hr_decide', 'app.manage', 'onboarding.manage'];
const FOUNDER_PERMS = ['req.founder_decide', 'pm.approve'];

/** Strongest first: a person who is both HR and a manager gets the HR Home. */
export function homeRoleFor({ perms, isAdmin, isManager }: HomeRoleInput): HomeRole {
  if (isAdmin) return 'ADMIN';
  if (hasAnyPerm(perms, HR_PERMS)) return 'HR';
  if (hasAnyPerm(perms, FOUNDER_PERMS)) return 'FOUNDER';
  if (isManager) return 'MANAGER';
  return 'EMPLOYEE';
}

// ------------------------------------------------------------------ card order

export const HOME_CARD_IDS = [
  'quick-actions', 'my-tasks', 'acknowledgements', 'pipeline', 'team-attendance', 'leave-balance', 'upcoming',
  'attendance', 'profile', 'login-summary', 'announcements', 'ceo-speak', 'calendar', 'celebrations', 'mood',
  'quick-links', 'quick-reports',
] as const;
export type HomeCardId = (typeof HOME_CARD_IDS)[number];

/**
 * First = most important. The own punch lives in the bar at the top of Home for everyone, so the full attendance card
 * (punch history) sits lower. Social cards (announcements, birthdays, mood) come after the work cards.
 */
const ORDER: Record<HomeRole, HomeCardId[]> = {
  EMPLOYEE: ['quick-actions', 'my-tasks', 'acknowledgements', 'leave-balance', 'upcoming', 'attendance', 'profile', 'announcements', 'calendar', 'celebrations', 'ceo-speak', 'mood', 'quick-links', 'quick-reports'],
  MANAGER: ['my-tasks', 'team-attendance', 'quick-actions', 'leave-balance', 'upcoming', 'acknowledgements', 'attendance', 'profile', 'calendar', 'announcements', 'celebrations', 'ceo-speak', 'mood', 'quick-links', 'quick-reports'],
  HR: ['my-tasks', 'team-attendance', 'pipeline', 'quick-actions', 'upcoming', 'acknowledgements', 'announcements', 'celebrations', 'leave-balance', 'attendance', 'profile', 'calendar', 'ceo-speak', 'mood', 'quick-reports', 'quick-links', 'login-summary'],
  FOUNDER: ['pipeline', 'my-tasks', 'team-attendance', 'quick-actions', 'upcoming', 'announcements', 'ceo-speak', 'acknowledgements', 'leave-balance', 'attendance', 'profile', 'calendar', 'celebrations', 'mood', 'quick-reports', 'quick-links'],
  ADMIN: ['my-tasks', 'quick-actions', 'login-summary', 'team-attendance', 'pipeline', 'upcoming', 'announcements', 'acknowledgements', 'celebrations', 'leave-balance', 'attendance', 'profile', 'calendar', 'ceo-speak', 'mood', 'quick-reports', 'quick-links'],
};

export const homeCardOrder = (role: HomeRole): HomeCardId[] => ORDER[role];

/** Sort key for a card id: its place in the role's order, and unknown ids after everything else. */
export const homeCardRank = (role: HomeRole, id: string): number => {
  const i = (ORDER[role] as string[]).indexOf(id);
  return i === -1 ? 1000 : i;
};

// ------------------------------------------------------------------ quick actions

export type ActionIcon =
  | 'refer' | 'leave' | 'fix' | 'claim' | 'letters' | 'payslip' | 'policies' | 'tasks' | 'approvals' | 'team' | 'claimApprovals'
  | 'hiring' | 'addPerson' | 'announce' | 'reports' | 'users' | 'payroll' | 'requisition' | 'setup';

export interface QuickActionDef {
  id: string;
  label: string;
  icon: ActionIcon;
  target?: WidgetTarget;
  /** Opens the announcements editor on Home instead of another page. */
  special?: 'announce';
  /** Only offered to people holding one of these permissions (or a company admin). */
  needsPerm?: string[];
}

const A: Record<string, QuickActionDef> = {
  leave: { id: 'leave', label: 'Apply Leave', icon: 'leave', target: { module: 'leave-management', section: 'my' } },
  fix: { id: 'fix', label: 'Fix Attendance', icon: 'fix', target: { module: 'leave-management', section: 'regularization' } },
  claim: { id: 'claim', label: 'Raise Claim', icon: 'claim', target: { module: 'payroll', section: 'claims' } },
  payslip: { id: 'payslip', label: 'View Payslip', icon: 'payslip', target: { module: 'payroll', section: 'payslips' } },
  tasks: { id: 'tasks', label: 'My Tasks', icon: 'tasks', target: { module: 'people', section: 'tasks' } },
  policies: { id: 'policies', label: 'My Policies', icon: 'policies', target: { module: 'document-version-control', docTab: 'employee' }, needsPerm: ['doc.acknowledge'] },
  letters: { id: 'letters', label: 'My Letters', icon: 'letters', target: { module: 'people', section: 'myletters' } },
  refer: { id: 'refer', label: 'Refer a Candidate', icon: 'refer', target: { module: 'my-hiring' } },
  approvals: { id: 'approvals', label: 'Approvals', icon: 'approvals', target: { module: 'leave-management', section: 'approvals' } },
  team: { id: 'team', label: 'Team Calendar', icon: 'team', target: { module: 'leave-management', section: 'team' } },
  claimApprovals: { id: 'claimApprovals', label: 'Claim Approvals', icon: 'claimApprovals', target: { module: 'payroll', section: 'approvals' } },
  hireRequest: { id: 'hireRequest', label: 'Hiring Request', icon: 'requisition', target: { module: 'talent-acquisition-requisitions' }, needsPerm: ['req.create'] },
  addPerson: { id: 'addPerson', label: 'Onboard Someone', icon: 'addPerson', target: { module: 'people', section: 'onboarding' }, needsPerm: ['lifecycle.manage'] },
  announce: { id: 'announce', label: 'Post Announcement', icon: 'announce', special: 'announce', needsPerm: ['announce.manage'] },
  attReports: { id: 'attReports', label: 'Attendance Reports', icon: 'reports', target: { module: 'leave-management', section: 'reports' }, needsPerm: ['leave.report', 'leave.manage'] },
  pipeline: { id: 'pipeline', label: 'Hiring Overview', icon: 'hiring', target: { module: 'talent-acquisition-overview' }, needsPerm: ['talent.view'] },
  requisitions: { id: 'requisitions', label: 'Requisitions', icon: 'requisition', target: { module: 'talent-acquisition-requisitions' }, needsPerm: ['req.view_all', 'req.founder_decide', 'req.hr_decide'] },
  payrollRun: { id: 'payrollRun', label: 'Payroll Run', icon: 'payroll', target: { module: 'payroll', section: 'run' }, needsPerm: ['payroll.view', 'payroll.manage'] },
  users: { id: 'users', label: 'Users & Roles', icon: 'users', target: { module: 'administration' }, needsPerm: ['users.manage', 'roles.manage', 'departments.manage'] },
  leaveSetup: { id: 'leaveSetup', label: 'Leave Setup', icon: 'setup', target: { module: 'leave-management', section: 'manage' }, needsPerm: ['leave.manage'] },
};

const ACTIONS: Record<HomeRole, string[]> = {
  EMPLOYEE: ['leave', 'fix', 'claim', 'payslip', 'tasks', 'policies', 'letters', 'refer'],
  MANAGER: ['approvals', 'team', 'leave', 'claimApprovals', 'hireRequest', 'claim', 'payslip', 'policies'],
  HR: ['approvals', 'addPerson', 'announce', 'attReports', 'pipeline', 'leaveSetup', 'claimApprovals', 'payrollRun'],
  FOUNDER: ['requisitions', 'pipeline', 'attReports', 'approvals', 'announce', 'leave', 'payslip', 'policies'],
  ADMIN: ['users', 'approvals', 'addPerson', 'announce', 'payrollRun', 'pipeline', 'attReports', 'leaveSetup'],
};

/**
 * The shortcuts for this kind of Home, minus any the person holds no permission for. Always at most eight, filled up from the
 * everyday personal ones so the grid is never half empty.
 */
export function quickActionsFor(role: HomeRole, perms: string[] | undefined | null, isAdmin: boolean): QuickActionDef[] {
  const allowed = (a: QuickActionDef) => isAdmin || !a.needsPerm || hasAnyPerm(perms, a.needsPerm);
  const out: QuickActionDef[] = [];
  const add = (id: string) => { const a = A[id]; if (a && allowed(a) && !out.some((x) => x.id === id)) out.push(a); };
  for (const id of ACTIONS[role]) add(id);
  for (const id of ACTIONS.EMPLOYEE) { if (out.length >= 8) break; add(id); }
  return out.slice(0, 8);
}
