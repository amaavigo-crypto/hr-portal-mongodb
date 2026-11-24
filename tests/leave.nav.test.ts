import assert from 'node:assert/strict';
import { attendanceTabFor, leaveNavItems, resolveSection } from '../src/components/leave/leaveNav.ts';

const me = (extra: any = {}) => ({ found: true, configured: true, ...extra });
const keys = (m: any) => leaveNavItems(m).map((i) => i.key);

// an employee gets four sections, not seven
assert.deepEqual(keys(me()), ['today', 'my', 'attendance', 'team']);
// a manager adds Approvals, HR adds Manage
assert.deepEqual(keys(me({ isManager: true })), ['today', 'my', 'attendance', 'team', 'teamweek', 'approvals']);
assert.deepEqual(keys(me({ canManage: true })), ['today', 'my', 'attendance', 'team', 'approvals', 'manage']);
assert.deepEqual(keys(me({ canReport: true })), ['today', 'my', 'attendance', 'team', 'manage']);
// nothing before leave is set up or when the person has no record
assert.deepEqual(keys(me({ configured: false })), []);
assert.deepEqual(keys({ found: false }), []);

// the three pages that became tabs still resolve, and open their tab
const items = leaveNavItems(me());
assert.equal(resolveSection('regularization', items), 'attendance');
assert.equal(resolveSection('application', items), 'attendance');
assert.equal(resolveSection('reports', items), 'attendance');
assert.equal(attendanceTabFor('regularization'), 'regularization');
assert.equal(attendanceTabFor('application'), 'application');
assert.equal(attendanceTabFor('reports'), 'reports');
assert.equal(attendanceTabFor('attendance'), null);
assert.equal(resolveSection('today', items), 'today');
assert.equal(resolveSection('approvals', items), 'today', 'a section the person cannot open falls back to the first one');
console.log('leave.nav: ok');
