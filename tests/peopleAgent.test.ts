import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLifecycle } from '../api/_lib/lifecycleApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import {
  PEOPLE_AGENT_TOOLS, canManagePeople, peopleToolsFor, summarizeClearance, summarizeExits, summarizeOnboarding, summarizeTasks,
} from '../shared/peopleAgentTools.ts';

// ------------------------------------------------------------------ pure parts

const names = (w: any) => peopleToolsFor(w).map((t) => t.name);
assert.ok(!names({ perms: [] }).includes('get_onboarding_overview'), 'an employee is not told about the HR overview');
assert.ok(names({ perms: [] }).includes('propose_task_done') && names({ perms: [] }).includes('get_exits'));
assert.equal(names({ perms: ['lifecycle.manage'] }).length, PEOPLE_AGENT_TOOLS.length);
assert.equal(names({ perms: [], isCompanyAdmin: true }).length, PEOPLE_AGENT_TOOLS.length);
assert.equal(canManagePeople({ perms: ['leave.manage'] }), false, 'leave.manage is not lifecycle.manage');
assert.ok(PEOPLE_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|company_id|cid/)), 'no tool takes a company argument');
assert.ok(PEOPLE_AGENT_TOOLS.every((t) => !/resign|withdraw/i.test(t.name)), 'resigning and withdrawing stay on the screen');

const today = '2026-11-24';
const ts = summarizeTasks([
  { id: 'a', title: 'Bank', status: 'OPEN', dueDate: '2026-11-20', own: true }, { id: 'b', title: 'Docs', status: 'OPEN', dueDate: '2026-12-01', own: true },
  { id: 'c', title: 'Laptop', status: 'DONE', dueDate: '2026-11-01', forName: 'Nia' }, { id: 'd', title: 'Welcome', status: 'OPEN', forName: 'Nia' },
], today);
assert.deepEqual([ts.total, ts.open, ts.overdue, ts.done], [4, 3, 1, 1]);
assert.equal(ts.tasks[0].forPerson, 'you');
const cl = summarizeClearance([{ deptId: 'it', label: 'IT', status: 'CLEARED' }, { deptId: 'fin', label: 'Finance', status: 'DUES', dues: 120.5 }, { deptId: 'hr', label: 'HR', status: 'WAIVED' }, { deptId: 'adm', label: 'Admin', status: 'PENDING' }]);
assert.deepEqual([cl.departments, cl.cleared, cl.pending, cl.withDues, cl.duesTotal], [4, 2, 1, 1, 120.5]);
const ex = summarizeExits([
  { status: 'SUBMITTED', employee: { uid: 'x', name: 'X' } }, { status: 'MANAGER_APPROVED', employee: { uid: 'y', name: 'Y' } },
  { status: 'APPROVED', employee: { uid: 'z', name: 'Z' }, clearance: [{ status: 'CLEARED' }, { status: 'PENDING' }] }, { status: 'COMPLETED', employee: { uid: 'w', name: 'W' } },
]);
assert.deepEqual([ex.total, ex.open, ex.waitingOnManager, ex.waitingOnHr, ex.inNotice], [4, 3, 1, 1, 1]);
assert.equal(ex.exits[3].status, 'COMPLETED', 'open cases come first');
assert.deepEqual(ex.exits.find((e) => e.uid === 'z')?.clearance, { cleared: 1, of: 2, withDues: 0 });
const ob = summarizeOnboarding([{ name: 'A', open: 2, overdue: 1, total: 5 }, { name: 'B', open: 0, overdue: 0, total: 5 }, { name: 'C', open: 3, overdue: 0, total: 6 }], [{ name: 'D' }]);
assert.deepEqual([ob.joinersWithChecklist, ob.joinersWithOpenTasks, ob.openTasks, ob.overdueTasks, ob.withoutChecklistCount], [3, 2, 5, 1, 1]);
assert.equal(ob.joiners[0].name, 'A', 'overdue first');

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['lifecycle.manage']);
const EMP = tokenFor('u_emp');
const MGR = tokenFor('u_mgr');
const NEW = tokenFor('u_new');
const OTHER = tokenFor('u_other');
const FOREIGN = tokenFor('u_hr', ['lifecycle.manage'], false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name, title] of [['u_hr', 'Hema HR', 'HR'], ['u_emp', 'Esha Employee', 'Analyst'], ['u_mgr', 'Mira Manager', 'Lead'], ['u_new', 'Nia New', 'Associate'], ['u_other', 'Omar Other', 'Dev']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase(), title });
}
fdb.seed('leaveProfiles', `${CID}__u_emp`, { uid: 'u_emp', companyId: CID, managerUid: 'u_mgr', joinDate: '2022-03-01' });
fdb.seed('leaveProfiles', `${CID}__u_new`, { uid: 'u_new', companyId: CID, managerUid: 'u_mgr', joinDate: addDays(istToday(), 5) });
fdb.seed('leaveProfiles', `${CID}__u_other`, { uid: 'u_other', companyId: CID, joinDate: '2023-01-01' });

const life = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLifecycle({ method, action, headers, body, query });
assert.equal((await life(HR, 'POST', 'onboarding-start', { uid: 'u_new' })).status, 200);

process.env.OPENAI_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
let seenTools: string[] = [];
let toolReplies: any[] = [];
type Call = { name: string; args?: any };
const script = (calls: Call[]) => {
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    const last = body.messages[body.messages.length - 1];
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const message = last.role !== 'tool'
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
      : { role: 'assistant', content: 'Here is what I found.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const ask = (headers: any, question: string) => routeAssistant({ method: 'POST', action: 'ask', headers, query: {}, body: { question } });
const act = (headers: any, action: 'confirm' | 'dismiss', id: string) => routeAssistant({ method: 'POST', action, headers, query: {}, body: { id } });
const tools = async (headers: any, calls: Call[], q = 'Please check') => { script(calls); const r = await ask(headers, q); return r; };

// 1. a joiner sees only their own tasks; HR-only tools are neither offered nor usable
let r = await tools(NEW, [{ name: 'get_my_onboarding_tasks' }, { name: 'get_onboarding_overview' }]);
assert.ok(!seenTools.includes('get_onboarding_overview') && seenTools.includes('propose_task_done'), `NEW was shown: ${seenTools}`);
const t0 = toolReplies[0];
assert.ok(t0.open >= 6 && t0.tasks.every((t: any) => t.forPerson === 'you'));
assert.match(toolReplies[1].error, /Not available/, 'a forced HR tool call is refused by the server');

// 2. mark a task done: card first, nothing saved until Confirm, owner only, once only
const docs = t0.tasks.find((t: any) => !/bank/i.test(t.title) && t.assignedTo === 'EMPLOYEE') || t0.tasks.find((t: any) => !/bank/i.test(t.title));
r = await tools(NEW, [{ name: 'propose_task_done', args: { taskId: docs.taskId, note: 'Uploaded' } }]);
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
const card = r.json.proposals[0];
assert.match(card.title, /Mark task done/);
const statusOf = async (headers: any, id: string) => (await life(headers, 'GET', 'onboarding-my')).json.tasks.find((t: any) => t.id === id)?.status;
assert.equal(await statusOf(NEW, docs.taskId), 'OPEN', 'nothing changes before Confirm');
assert.equal((await act(OTHER, 'confirm', card.id)).status, 404, 'only the person it was prepared for can confirm');
assert.equal((await act(NEW, 'confirm', card.id)).json.status, 'DONE');
assert.equal(await statusOf(NEW, docs.taskId), 'DONE');
assert.equal((await act(NEW, 'confirm', card.id)).json.status, 'DONE', 'a second click is harmless');
r = await tools(NEW, [{ name: 'propose_task_done', args: { taskId: docs.taskId } }, { name: 'propose_task_done', args: { taskId: 'c1__u_hr__made-up' } }]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /already done/);
assert.match(toolReplies[1].error, /not in this person/);

// 3. HR overview
r = await tools(HR, [{ name: 'get_onboarding_overview' }]);
assert.ok(seenTools.includes('get_onboarding_overview'));
assert.equal(toolReplies[0].joinersWithChecklist, 1);
assert.ok(toolReplies[0].openTasks >= 5);

// 4. resignation: the employee has no way to resign or withdraw through the agent
assert.ok(!seenTools.some((n) => /resign|withdraw/i.test(n)));
assert.equal((await life(EMP, 'POST', 'exit-resign', { requestedLastDay: addDays(istToday(), 29), comments: 'Moving' })).status, 200);
r = await tools(EMP, [{ name: 'get_my_exit' }, { name: 'get_exits' }]);
assert.equal(toolReplies[0].status, 'SUBMITTED');
assert.equal(toolReplies[1].open, 0, 'an employee who manages nobody sees no exits');
r = await tools(MGR, [{ name: 'get_exits' }]);
assert.equal(toolReplies[0].open, 1);
assert.equal(toolReplies[0].waitingOnManager, 1);
assert.equal(toolReplies[0].exits[0].uid, 'u_emp');
r = await tools(OTHER, [{ name: 'get_exits' }, { name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE' } }]);
assert.equal(toolReplies[0].open, 0, 'a colleague who is not the manager sees nothing');
assert.match(toolReplies[1].error, /no resignation/);

// 5. the manager decides; HR makes the final decision; rules hold
r = await tools(EMP, [{ name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE' } }]);
assert.match(toolReplies[0].error, /own resignation/);
r = await tools(MGR, [{ name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'REJECT' } }, { name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE', lastWorkingDay: addDays(istToday(), 10) } }]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /reason/i);
assert.match(toolReplies[1].error, /Only HR can change the last working day/);
r = await tools(MGR, [{ name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE', note: 'Fine' } }]);
const mgrCard = r.json.proposals[0];
assert.ok(mgrCard.lines.some((l: string) => /sends it to HR/.test(l)), `${mgrCard.lines}`);
assert.equal((await life(EMP, 'GET', 'exit-my')).json.exit.status, 'SUBMITTED', 'still waiting until the manager confirms');
const d1 = await act(MGR, 'confirm', mgrCard.id);
assert.equal(d1.json.status, 'DONE', JSON.stringify(d1.json));
assert.match(d1.json.message, /sent to HR/);
assert.equal((await life(EMP, 'GET', 'exit-my')).json.exit.status, 'MANAGER_APPROVED');
r = await tools(MGR, [{ name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE' } }]);
assert.match(toolReplies[0].error, /waiting for HR/, 'once it is with HR the manager has nothing to decide');
const lastDay = addDays(istToday(), 14);
r = await tools(HR, [{ name: 'propose_exit_decision', args: { uid: 'u_emp', decision: 'APPROVE', lastWorkingDay: lastDay } }]);
const hrCard = r.json.proposals[0];
assert.ok(hrCard.lines.some((l: string) => l.includes(lastDay)));
const d2 = await act(HR, 'confirm', hrCard.id);
assert.equal(d2.json.status, 'DONE', JSON.stringify(d2.json));
assert.match(d2.json.message, /Accepted/);
const exitNow = (await life(EMP, 'GET', 'exit-my')).json.exit;
assert.equal(exitNow.status, 'APPROVED');
assert.equal(exitNow.lastWorkingDay, lastDay);
assert.equal(exitNow.events.filter((e: any) => e.action === 'APPROVED').length, 1, 'accepted exactly once');
assert.equal((await act(HR, 'confirm', hrCard.id)).json.status, 'DONE');
assert.equal((await life(EMP, 'GET', 'exit-my')).json.exit.events.filter((e: any) => e.action === 'APPROVED').length, 1, 'a second confirm does not accept again');

// 6. no-dues clearance
r = await tools(HR, [{ name: 'get_exit_details', args: { uid: 'u_emp' } }]);
const allDepts = toolReplies[0].clearanceDetail.items as any[];
const dept = allDepts.find((c) => c.status === 'PENDING' && c.owner !== 'Mira Manager');
const mgrDept = allDepts.find((c) => c.owner === 'Mira Manager');
assert.ok(dept?.deptId, JSON.stringify(toolReplies[0]));
r = await tools(EMP, [{ name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'CLEARED' } }]);
assert.match(toolReplies[0].error, /own dues/);
r = await tools(MGR, [{ name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'WAIVED' } }, { name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'CLEARED' } }]);
assert.match(toolReplies[0].error, /Only HR can waive/);
assert.match(toolReplies[1].error, /owner of this department or HR/, 'a manager who does not own the department cannot clear it');
if (mgrDept) {
  r = await tools(MGR, [{ name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: mgrDept.deptId, status: 'CLEARED' } }]);
  assert.equal(r.json.proposals.length, 1, 'the owner of a department can clear it');
}
r = await tools(HR, [
  { name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'DUES' } },
  { name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'DUES', dues: 500 } },
  { name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: 'nope', status: 'CLEARED' } },
]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /amount owed/);
assert.match(toolReplies[1].error, /dues are for/);
assert.match(toolReplies[2].error, /not in this exit/);
r = await tools(HR, [{ name: 'propose_exit_clearance', args: { uid: 'u_emp', deptId: dept.deptId, status: 'DUES', dues: 500, note: 'Laptop charger' } }]);
const duesCard = r.json.proposals[0];
assert.ok(duesCard.destructive && duesCard.lines.some((l: string) => /500/.test(l)));
const getDept = async () => (await life(HR, 'GET', 'exit', {}, { uid: 'u_emp' })).json.exit.clearance.find((c: any) => c.deptId === dept.deptId);
assert.equal((await getDept()).status, 'PENDING', 'nothing changes before Confirm');
assert.equal((await act(HR, 'confirm', duesCard.id)).json.status, 'DONE');
assert.deepEqual([(await getDept()).status, (await getDept()).dues], ['DUES', 500]);
r = await tools(HR, [{ name: 'get_exit_details', args: { uid: 'u_emp' } }]);
assert.equal(toolReplies[0].clearanceDetail.withDues, 1);
assert.equal(toolReplies[0].clearanceDetail.duesTotal, 500);

// 7. another company's HR cannot reach this company's exits
r = await tools(FOREIGN, [{ name: 'get_exit_details', args: { uid: 'u_emp' } }, { name: 'get_exits' }]);
assert.ok(toolReplies[0].error || toolReplies[0].note, 'no cross-company exit details');
assert.equal(toolReplies[1].total, 0);

globalThis.fetch = realFetch;
console.log('people agent ok');
