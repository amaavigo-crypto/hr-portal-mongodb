import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { runReminders, runAllReminders } from '../api/_lib/reminderApi.ts';
import { RULES, ackDue, approvalOverdue, claimDue, digest, reviewDue, reviewState } from '../shared/reminderRules.ts';
import { addDays } from '../shared/leaveEngine.ts';

// ---------------------------------------------------------------- pure rules
const T = '2026-11-17';
assert.equal(ackDue(`${T}T01:00:00Z`, T), false, 'a policy published today is not nagged yet');
assert.equal(ackDue('2026-11-15T00:00:00Z', T), true, 'two days waiting: first nudge');
assert.equal(ackDue('2026-11-01T00:00:00Z', T, '2026-11-16'), false, 'nudged yesterday: not again');
assert.equal(ackDue('2026-11-01T00:00:00Z', T, '2026-11-14'), true, 'every 3 days');
assert.equal(approvalOverdue('2026-11-14T00:00:00Z', T), true); assert.equal(approvalOverdue('2026-11-15T00:00:00Z', T), false);
assert.equal(claimDue('2026-11-10T00:00:00Z', T, '2026-11-16'), false); assert.equal(claimDue('2026-11-10T00:00:00Z', T, '2026-11-15'), true);
assert.equal(reviewState(addDays(T, 40), T), null); assert.equal(reviewState(addDays(T, 20), T), 'SOON'); assert.equal(reviewState(addDays(T, -1), T), 'OVERDUE');
assert.equal(reviewDue(addDays(T, 20), T), false, 'email starts 14 days ahead; Home shows 30');
assert.equal(reviewDue(addDays(T, 14), T), true); assert.equal(reviewDue(addDays(T, 14), T, addDays(T, -3)), false, 'weekly when far away');
assert.equal(reviewDue(addDays(T, 5), T, addDays(T, -3)), true, 'every 3 days in the last week');
assert.equal(reviewDue(addDays(T, -2), T, addDays(T, -5)), false, 'weekly once overdue'); assert.equal(reviewDue(addDays(T, -2), T, addDays(T, -7)), true);
assert.equal(RULES.reviewLeadDays, 30);
const one = digest('Esha', [{ key: 'a', kind: 'ACK', text: 'Leave policy' }]);
assert.equal(one.subject, 'Reminder: Leave policy');
const many = digest('Esha', [{ key: 'a', kind: 'ACK', text: 'Leave policy' }, { key: 'c', kind: 'CLAIM', text: 'Omar: Travel, Rs 900' }]);
assert.equal(many.subject, '2 things are waiting for you'); assert.ok(many.body.includes('Policies to read') && many.body.includes('Expense claims waiting'));

// ---------------------------------------------------------------- the daily job
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async () => ({}) } });
const CID = 'c1', TODAY = '2026-11-17';
fdb.seed('companies', CID, { name: 'Acme', status: 'ACTIVE' });
fdb.seed('companies', 'c2', { name: 'Dormant', status: 'SUSPENDED' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_mgr', 'Mira Manager'], ['u_emp', 'Esha Employee'], ['u_doc', 'Dev Doc']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
}
fdb.seed('leaveSettings', CID, { companyId: CID, notifyEmails: ['u_hr@acme.com'] });
fdb.seed('leaveProfiles', 'p1', { companyId: CID, uid: 'u_emp', managerUid: 'u_mgr', joinDate: '2020-01-01' });
fdb.seed('documents', 'M1', { companyId: CID, title: 'Leave policy', active: true });
fdb.seed('versions', 'V1', { companyId: CID, status: 'PUBLISHED', documentMasterId: 'M1', documentTitle: 'Leave policy', versionNumber: '2.0', reviewDueDate: addDays(TODAY, 10), createdById: 'u_doc' });
fdb.seed('acknowledgments', 'A1', { companyId: CID, employeeId: 'u_emp', status: 'PENDING', documentVersionId: 'V1', documentTitle: 'Leave policy', versionNumber: '2.0', createdAt: `${addDays(TODAY, -5)}T00:00:00Z` });
fdb.seed('acknowledgments', 'A2', { companyId: CID, employeeId: 'u_emp', status: 'PENDING', documentVersionId: 'OLD', documentTitle: 'Old policy', createdAt: `${addDays(TODAY, -9)}T00:00:00Z` });
fdb.seed('payrollClaims', 'K1', { companyId: CID, uid: 'u_emp', status: 'SUBMITTED', category: 'Travel', amount: 900, createdAt: `${addDays(TODAY, -4)}T00:00:00Z` });
fdb.seed('payrollClaims', 'K2', { companyId: CID, uid: 'u_emp', status: 'SUBMITTED', category: 'Food', amount: 200, createdAt: `${TODAY}T00:00:00Z` });

const first = await runReminders(CID, TODAY);
assert.deepEqual(first, { people: 3, items: 3, emails: 3 }, 'employee: policy; manager: old claim; document owner: review');
const note = (uid: string) => fdb.all('leaveNotifications').filter((n: any) => n.uid === uid);
assert.equal(note('u_emp').length, 1); assert.equal(note('u_mgr').length, 1); assert.equal(note('u_doc').length, 1);
assert.equal(note('u_hr').length, 0, 'HR is only the fallback when there is no manager');
assert.ok(note('u_mgr')[0].title.includes('Esha Employee: Travel'), 'the manager hears about the claim');
assert.equal(fdb.all('reminderLog').length, 3, 'the stale older-version acknowledgement and the claim made today are left alone');

// running it again the same day sends nothing
assert.equal((await runReminders(CID, TODAY)).emails, 0);
// the next day it is still too soon; three days later the policy and the review come round again, the claim after two
assert.equal((await runReminders(CID, addDays(TODAY, 1))).emails, 0);
const later = await runReminders(CID, addDays(TODAY, 3));
assert.equal(later.emails, 3);

// a claimant with no manager goes to HR; an employee never reminds themselves
fdb.seed('payrollClaims', 'K3', { companyId: CID, uid: 'u_mgr', status: 'SUBMITTED', category: 'Fuel', amount: 500, createdAt: `${addDays(TODAY, -6)}T00:00:00Z` });
const hrRun = await runReminders(CID, addDays(TODAY, 3));
assert.equal(hrRun.emails, 1); assert.equal(note('u_hr').length, 1);

// off switch, and only active companies are visited
process.env.REMINDERS_OFF = '1';
assert.equal((await runReminders(CID, addDays(TODAY, 30))).emails, 0);
delete process.env.REMINDERS_OFF;
const all = await runAllReminders(addDays(TODAY, 30));
assert.deepEqual(Object.keys(all), [CID]);
console.log('reminder tests passed');
