/**
 * "Needs attention": the pure builders and the whole list through the real module routes (the bell).
 * Run: npx tsx tests/attention.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { attentionFor } from '../api/_lib/attentionApi.ts';
import { routeHome } from '../api/_lib/homeApi.ts';
import {
  MAX_PER_MODULE, ackItems, assemble, leaveItems, payrollItems, peopleItems, performanceItems, reviewItems, taskItems,
} from '../shared/attention.ts';
import { istToday } from '../shared/leaveEngine.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';

const TODAY = istToday();
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ pure parts
const lv = leaveItems({
  leaves: [{ id: 'a', name: 'Asha', typeName: 'Casual', from: '2026-12-01', to: '2026-12-02', waitingDays: 1, stage: 'MANAGER' }, { id: 'b', name: 'Ben', typeName: 'Sick', from: '2026-12-03', to: '2026-12-03', waitingDays: 6, escalated: true, stage: 'CANCEL' }],
  regularizations: [{ id: 'r', name: 'Cy', date: '2026-11-20' }],
});
assert.equal(lv.length, 3);
assert.match(lv[1].title, /cancellation/i);
assert.equal(lv[1].urgent, true);
assert.deepEqual(lv[0].target, { module: 'leave-management', section: 'approvals' });

const ak = ackItems({ active: { count: 11, items: [{ documentId: 'D1', title: 'Code of Conduct', versionNumber: '2.0' }] } });
assert.equal(ak.length, 11, 'items the route did not list still count');
assert.equal(ak[0].target.docTab, 'employee');
assert.equal(ackItems({ active: { count: 0, items: [] } }).length, 0);

assert.equal(reviewItems({ items: [{ document: 'Leave', version: '2.0', documentCode: 'A1', createdBy: 'Rita', createdDaysAgo: 4 }], sentBack: [{ document: 'Travel', version: '1.1', documentCode: 'A2', createdDaysAgo: 2 }] }).length, 2);

const tk = taskItems({ tasks: [{ id: '1', title: 'Collect laptop', status: 'OPEN', own: true, dueDate: ago(3) }, { id: '2', title: 'Done thing', status: 'DONE', own: true }, { id: '3', title: 'Set up email', status: 'OPEN', own: false, forName: 'Nia', dueDate: ago(-5) }] }, TODAY);
assert.equal(tk.length, 2, 'done tasks are not items');
assert.deepEqual([tk[0].urgent, tk[0].waitingDays, tk[1].urgent, tk[1].title], [true, 3, false, 'Set up email (for Nia)']);

const row = (o: any) => ({ uid: 'x', name: 'X', empId: 'E', department: 'Ops', title: 'S', joinDate: '2026-01-01', mobile: '9', identity: { PAN: { status: 'APPROVED', hasNumber: true }, AADHAAR: { status: 'APPROVED', hasNumber: true } }, qualifications: 1, family: 1, personal: true, ...o });
const mine = row({ uid: 'me', identity: { PAN: { status: 'REJECTED', note: 'blurry', hasNumber: false }, AADHAAR: { status: 'APPROVED', hasNumber: true } }, mobile: '' });
const theirs = row({ uid: 'o', name: 'Omar', identity: { PAN: { status: 'PENDING', hasNumber: false, pendingMasked: 'XXXX1234', pendingSince: ago(5) }, AADHAAR: { status: 'APPROVED', hasNumber: true } } });
const pe = peopleItems([mine, theirs], 'me', TODAY);
assert.ok(pe.some((i) => /Submit your .*again/.test(i.title) && i.urgent));
assert.ok(pe.some((i) => i.title === 'Complete your profile' && /Mobile/.test(i.detail || '')));
assert.ok(pe.some((i) => /Review Omar's/.test(i.title) && i.waitingDays === 5));
assert.equal(peopleItems([mine], 'me', TODAY).filter((i) => /^Review /.test(i.title)).length, 0, 'someone without HR rights gets no review queue');

assert.equal(performanceItems({ todo: [{ who: 'me', go: 'review', id: 'r1', text: 'Do your Q3 self-review' }] })[0].target.module, 'performance');
const states = [
  { month: '2026-11', state: { enabled: true, status: 'DRAFT', next: 'FINANCE', steps: [{ step: 'HR' }, { step: 'FINANCE', problem: '' }, { step: 'SIGNATORY' }] } },
  { month: '2026-10', state: { enabled: true, status: 'DRAFT', next: 'SIGNATORY', steps: [{ step: 'SIGNATORY', problem: 'Separation of duties' }] } },
  { month: '2026-09', state: { enabled: false } },
];
assert.deepEqual(payrollItems(states).map((i) => i.title), ['Finance verification: 2026-11 payroll'], 'only when it is this person\'s turn');

const many = assemble([...Array.from({ length: 14 }, (_, i) => ({ id: `leave:${i}`, module: 'leave' as const, title: `L${i}`, waitingDays: i, target: { module: 'leave-management' as const } })), ...ak, { id: 'leave:3', module: 'leave', title: 'dup', target: { module: 'leave-management' } }]);
assert.equal(many.total, 25, 'ids are unique');
assert.equal(many.groups[0].module, 'leave');
assert.equal(many.groups[0].items.length, MAX_PER_MODULE);
assert.equal(many.groups[0].more, 4);
assert.equal(many.groups[0].items[0].title, 'L13', 'longest waiting first');
assert.equal(assemble([]).total, 0);

// ------------------------------------------------------------------ the whole list through the real routes
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const EMP = tokenFor('u_emp', ['doc.acknowledge']);
const MGR = tokenFor('u_mgr', ['doc.acknowledge', 'doc.review']);
const HR = tokenFor('u_hr', ['lifecycle.manage', 'leave.manage']);
fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name, mgr] of [['u_hr', 'Hema HR', ''], ['u_mgr', 'Mira Manager', ''], ['u_emp', 'Esha Employee', 'u_mgr']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase(), title: 'Staff' });
  fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: mgr, joinDate: '2022-01-01' });
}
// a published policy Esha has not acknowledged, and a version waiting for review
fdb.seed('documents', 'm1', { companyId: CID, active: true, acknowledgementRequired: true, confidentiality: 'Public (All Employees)', documentId: 'AMA-1', title: 'Code of Conduct', currentStatus: 'PUBLISHED' });
fdb.seed('versions', 'v1', { companyId: CID, documentMasterId: 'm1', documentId: 'AMA-1', documentTitle: 'Code of Conduct', versionNumber: '2.0', status: 'PUBLISHED', publishedAt: '2026-11-01T00:00:00Z' });
fdb.seed('versions', 'v2', { companyId: CID, documentMasterId: 'm1', documentId: 'AMA-9', documentTitle: 'Travel Policy', versionNumber: '1.0', status: 'IN_REVIEW', createdById: 'u_hr', createdByName: 'Hema HR', createdAt: `${ago(4)}T00:00:00Z` });
fdb.seed('acknowledgments', 'a1', { companyId: CID, documentId: 'AMA-1', documentTitle: 'Code of Conduct', documentVersionId: 'v1', versionNumber: '2.0', employeeId: 'u_emp', employeeName: 'Esha Employee', status: 'PENDING' });
// an onboarding task for Esha, overdue
fdb.seed('lifecycleTasks', 't1', { companyId: CID, uid: 'u_emp', assignee: 'EMPLOYEE', title: 'Upload your photo', status: 'OPEN', dueDate: ago(2), kind: 'TASK' });
// a pending leave request waiting on Mira
fdb.seed('leaveRequests', 'lr1', { id: 'lr1', companyId: CID, uid: 'u_emp', name: 'Esha Employee', managerUid: 'u_mgr', status: 'PENDING', typeId: 'cl', typeName: 'Casual leave', from: '2026-12-10', to: '2026-12-11', days: 2, createdAt: `${ago(2)}T08:00:00Z`, stepIndex: 0, steps: [{ role: 'MANAGER' }, { role: 'HR' }] });
// an identity document waiting for HR
fdb.seed('employeeIdentities', `${CID}__u_emp__PAN`, { companyId: CID, uid: 'u_emp', type: 'PAN', number: '', pendingNumber: 'ABCDE1234F', status: 'PENDING', note: '', updatedAt: `${ago(6)}T00:00:00Z`, updatedBy: 'u_emp' });

const titles = (r: any) => r.groups.flatMap((g: any) => g.items.map((i: any) => i.title));

const emp = await attentionFor(EMP);
assert.ok(titles(emp).includes('Acknowledge Code of Conduct'), JSON.stringify(titles(emp)));
assert.ok(titles(emp).includes('Upload your photo'));
assert.ok(!titles(emp).some((t: string) => /Approve|Review Travel|Review Esha/.test(t)), 'an employee gets none of the approver items');
assert.equal(emp.partial, false);

const mgr = await attentionFor(MGR);
assert.ok(titles(mgr).includes("Approve Esha Employee's Casual leave"), JSON.stringify(titles(mgr)));
assert.ok(titles(mgr).includes('Review Travel Policy v1.0'));
assert.ok(!titles(mgr).includes('Upload your photo'), 'not someone else\'s task');

const hr = await attentionFor(HR);
assert.ok(titles(hr).some((t: string) => /Review Esha Employee's/.test(t)), JSON.stringify(titles(hr)));
assert.ok(hr.total === hr.groups.reduce((n: number, g: any) => n + g.count, 0));

// another company, and the route itself
const foreign = await attentionFor(tokenFor('u_hr', ['lifecycle.manage', 'leave.manage'], 'c2').valueOf() as any).catch(() => ({ total: 0 }));
assert.equal((foreign as any).total, 0);
const viaRoute = await routeHome({ method: 'GET', action: 'attention', headers: EMP, query: {}, body: {} });
assert.equal(viaRoute.status, 200);
assert.equal(viaRoute.json.total, emp.total);
assert.equal((await routeHome({ method: 'POST', action: 'attention', headers: EMP, query: {}, body: {} })).status === 200, false, 'read only');

// the same list through Ask HR
process.env.OPENAI_API_KEY = 'test-key';
let seen: string[] = []; let replies: any[] = [];
globalThis.fetch = (async (_u: any, init: any) => {
  const body = JSON.parse(init.body);
  seen = (body.tools || []).map((t: any) => t.function.name);
  replies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
  const last = body.messages[body.messages.length - 1];
  const message = last.role !== 'tool'
    ? { role: 'assistant', content: null, tool_calls: [{ id: 't0', type: 'function', function: { name: 'get_my_attention', arguments: '{}' } }] }
    : { role: 'assistant', content: 'Done.' };
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as any;
await routeAssistant({ method: 'POST', action: 'ask', headers: EMP, query: {}, body: { question: 'what needs my attention?' } });
assert.ok(seen.includes('get_my_attention'));
assert.equal(replies[0].total, emp.total);
assert.ok(replies[0].groups.some((g: any) => g.items.some((i: any) => i.what === 'Acknowledge Code of Conduct')));

console.log('attention tests passed');
