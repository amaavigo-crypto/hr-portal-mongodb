import assert from 'node:assert/strict';
import { DEFAULT_ROLE_TEMPLATES, ALL_PERMISSION_KEYS } from '../shared/permissions.ts';
import { HOME_CARD_IDS, homeCardOrder, homeCardRank, homeRoleFor, quickActionsFor } from '../shared/homeRole.ts';

const perms = (slug: string) => DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === slug)!.permissions;

// ---- who gets which Home
assert.equal(homeRoleFor({ perms: ALL_PERMISSION_KEYS, isAdmin: true, isManager: true }), 'ADMIN');
assert.equal(homeRoleFor({ perms: perms('hr-head'), isAdmin: false, isManager: true }), 'HR', 'HR who also manages people gets the HR Home');
assert.equal(homeRoleFor({ perms: perms('hr'), isAdmin: false, isManager: false }), 'HR');
assert.equal(homeRoleFor({ perms: perms('approver'), isAdmin: false, isManager: false }), 'FOUNDER');
assert.equal(homeRoleFor({ perms: perms('department-head'), isAdmin: false, isManager: true }), 'MANAGER');
assert.equal(homeRoleFor({ perms: perms('employee'), isAdmin: false, isManager: false }), 'EMPLOYEE');
assert.equal(homeRoleFor({ perms: undefined, isAdmin: false, isManager: false }), 'EMPLOYEE');
assert.equal(homeRoleFor({ perms: perms('recruiter'), isAdmin: false, isManager: false }), 'HR', 'a recruiter runs hiring, so gets the hiring-first Home');

// ---- every role orders every known card exactly once, and nothing unknown
for (const role of ['ADMIN', 'HR', 'FOUNDER', 'MANAGER', 'EMPLOYEE'] as const) {
  const order = homeCardOrder(role);
  assert.equal(new Set(order).size, order.length, `${role}: duplicate card`);
  for (const id of order) assert.ok((HOME_CARD_IDS as readonly string[]).includes(id), `${role}: unknown card ${id}`);
  // the work cards come before the social ones
  for (const social of ['celebrations', 'mood', 'ceo-speak']) {
    if (order.includes(social as any)) assert.ok(homeCardRank(role, social) > homeCardRank(role, 'my-tasks'), `${role}: ${social} above My Tasks`);
  }
}
// an employee sees their own shortcuts and tasks first; the hiring pipeline is not for them
assert.ok(homeCardRank('EMPLOYEE', 'quick-actions') < homeCardRank('EMPLOYEE', 'announcements'));
assert.equal(homeCardRank('EMPLOYEE', 'pipeline'), 1000);
assert.equal(homeCardRank('EMPLOYEE', 'something-new'), 1000);
// the hiring pipeline leads for founders, and team attendance is near the top for managers
assert.equal(homeCardOrder('FOUNDER')[0], 'pipeline');
assert.ok(homeCardRank('MANAGER', 'team-attendance') <= 1);

// ---- quick actions
const labels = (role: any, p: string[], admin = false) => quickActionsFor(role, p, admin).map((a) => a.label);
const emp = labels('EMPLOYEE', perms('employee'));
assert.ok(emp.includes('Apply Leave') && emp.includes('Raise Claim') && emp.includes('View Payslip'));
assert.ok(!emp.includes('Mark Attendance'), 'the punch is on the bar at the top of Home');
assert.ok(!emp.includes('Post Announcement') && !emp.includes('Users & Roles') && !emp.includes('Payroll Run'));
assert.ok(emp.length <= 8 && emp.length >= 6);

const mgr = labels('MANAGER', perms('department-head'));
assert.equal(mgr[0], 'Approvals');
assert.ok(mgr.includes('Team Calendar') && mgr.includes('Hiring Request'));

const hr = quickActionsFor('HR', perms('hr-head'), false);
assert.ok(hr.some((a) => a.special === 'announce'), 'HR can post announcements');
assert.ok(hr.some((a) => a.label === 'Onboard Someone'));
assert.ok(!hr.some((a) => a.label === 'Payroll Run'), 'Head HR holds no payroll permission by default, so no payroll shortcut');

const adm = labels('ADMIN', ALL_PERMISSION_KEYS, true);
assert.ok(adm.includes('Users & Roles') && adm.includes('Payroll Run') && adm.includes('Post Announcement'));

// permission-gated shortcuts are dropped, and the grid is topped up from everyday ones instead of shrinking
const hrNoPayroll = quickActionsFor('HR', perms('hr'), false);
assert.ok(hrNoPayroll.length >= 6);
assert.equal(new Set(hrNoPayroll.map((a) => a.id)).size, hrNoPayroll.length, 'no repeated shortcut');
// every shortcut leads somewhere (a page or the announcement editor)
for (const role of ['ADMIN', 'HR', 'FOUNDER', 'MANAGER', 'EMPLOYEE'] as const) {
  for (const a of quickActionsFor(role, ALL_PERMISSION_KEYS, true)) assert.ok(a.target || a.special, `${role}/${a.id} goes nowhere`);
}
console.log('home.role: ok');
