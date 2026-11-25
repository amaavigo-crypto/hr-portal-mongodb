import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { istToday, weekday } from '../shared/leaveEngine.ts';
import {
  LEAVE_AGENT_TOOLS, matchLeaveType, proposalLive, addDays, cleanRange, cleanUid, countBy, matchEmployees, mayUseTool, roleLine, summarizeAttendance, toolsFor,
} from '../shared/leaveAgentTools.ts';

// ------------------------------------------------------------------ pure parts

const names = (w: any) => toolsFor(w).map((t) => t.name);
assert.deepEqual(names({ perms: [] }), ['get_pending_approvals', 'get_team_calendar', 'get_attendance_summary', 'propose_leave_decision', 'propose_attendance_decision', 'propose_apply_leave'], 'an employee gets the everyone tools only');
assert.ok(!names({ perms: ['leave.report'] }).includes('find_employee'), 'report access does not unlock people look-up');
assert.ok(names({ perms: ['leave.report'] }).includes('get_leave_exceptions'));
assert.equal(names({ perms: ['leave.manage'] }).length, LEAVE_AGENT_TOOLS.length, 'HR gets every tool');
assert.equal(names({ perms: [], isCompanyAdmin: true }).length, LEAVE_AGENT_TOOLS.length, 'a company admin gets every tool');
assert.equal(mayUseTool({ perms: [] }, { access: 'manage' }), false);
assert.match(roleLine({ perms: ['leave.manage'] }), /HR/);
assert.match(roleLine({ perms: [] }), /employee or manager/);
assert.ok(LEAVE_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|company_id|cid/)), 'no tool takes a company argument');

// ranges: bad input falls back, long ranges are cut, to is never before from
assert.deepEqual(cleanRange(undefined, undefined, '2026-11-24', 15), { from: '2026-11-24', to: '2026-12-08', cut: false });
assert.deepEqual(cleanRange('nonsense', '2026-13-45', '2026-11-24', 7, 31, '2026-11-18'), { from: '2026-11-18', to: '2026-11-24', cut: false });
assert.deepEqual(cleanRange('2026-11-01', '2026-12-31', '2026-11-24', 7), { from: '2026-11-01', to: '2026-12-01', cut: true });
assert.deepEqual(cleanRange('2026-11-10', '2026-11-01', '2026-11-24', 7), { from: '2026-11-10', to: '2026-11-10', cut: false });
assert.equal(addDays('2026-12-31', 1), '2027-01-01');

assert.equal(cleanUid('u_emp'), 'u_emp');
assert.equal(cleanUid('x" OR 1=1'), '');
assert.equal(cleanUid(undefined), '');

// the model never counts: the totals come from here
const sum = summarizeAttendance([
  { uid: 'a', name: 'Asha', days: [{ date: '2026-11-02', status: 'PRESENT' }, { date: '2026-11-03', status: 'LATE', late: true }, { date: '2026-11-04', status: 'ABSENT' }, { date: '2026-11-05', status: 'WEEKLY_OFF' }] },
  { uid: 'b', name: 'Bala', days: [{ date: '2026-11-02', status: 'ABSENT' }, { date: '2026-11-03', status: 'ABSENT' }, { date: '2026-11-04', status: 'LEAVE' }, { date: '2026-11-05', status: 'HALF_DAY' }] },
], 5);
assert.deepEqual(sum.totals, { present: 2, late: 1, halfDay: 1, onLeave: 1, absent: 3, incomplete: 0 });
assert.deepEqual(sum.mostAbsent.map((x) => [x.name, x.days]), [['Bala', 2], ['Asha', 1]]);
assert.deepEqual(sum.mostLate.map((x) => [x.name, x.days]), [['Asha', 1]]);
assert.deepEqual(countBy([{ s: 'A' }, { s: 'A' }, { s: 'B' }], (x) => x.s), { A: 2, B: 1 });

const staff = [{ name: 'Esha Employee', empId: 'E1', email: 'esha@acme.com', department: 'Ops' }, { name: 'Omar Other', empId: 'E2', email: 'omar@acme.com', department: 'Sales' }];
assert.deepEqual(matchEmployees(staff, 'esha').map((p) => p.empId), ['E1']);
assert.deepEqual(matchEmployees(staff, 'E2').map((p) => p.name), ['Omar Other']);
assert.deepEqual(matchEmployees(staff, 'sales').map((p) => p.name), ['Omar Other']);
assert.deepEqual(matchEmployees(staff, 'x'), [], 'one letter matches nobody');

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)

const fdb = new FakeFirestore();
__useFakeAdmin({
  db: fdb,
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = []) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const EMP = tokenFor('u_emp');
const MGR = tokenFor('u_mgr');
const OTHER_CO = { authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'u_x', email: 'x@other.com', cid: 'c2', cs: 'ACTIVE', perms: ['leave.manage'], adm: false })).toString('base64')}` };

fdb.seed('companies', CID, { name: 'Acme Ltd' });
fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name, cid] of [['u_mgr', 'Manu Manager', CID], ['u_hr', 'Hema HR', CID], ['u_emp', 'Esha Employee', CID], ['u_other', 'Omar Other', CID], ['u_x', 'Xavier Outsider', 'c2']]) {
  fdb.seed('employees', uid, { companyId: cid, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
const leave = async (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
assert.equal((await leave(HR, 'POST', 'apply-starter', { yearStartMonth: 4 })).status, 200);
await leave(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_emp', managerUid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_other', managerUid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_hr', joinDate: '2020-01-01' }] });
await leave(HR, 'POST', 'run-accrual');

// A scripted "model": the first reply asks for the given tool calls, the next one answers with a fixed sentence.
process.env.OPENAI_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
let seenTools: string[] = [];
let toolReplies: any[] = [];
type Call = { name: string; args?: any };
/** `rounds[i]` gets the tool results so far and returns the next calls (or null to let the model answer). A plain array is one round. */
const script = (rounds: Call[] | ((replies: any[]) => Call[] | null)[]) => {
  toolReplies = [];
  const fns: ((replies: any[]) => Call[] | null)[] = Array.isArray(rounds) && typeof rounds[0] === 'function' ? (rounds as any) : [() => rounds as Call[]];
  let round = 0;
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    const last = body.messages[body.messages.length - 1];
    if (last.role !== 'tool') round = 0;
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const next = round < fns.length ? fns[round++](toolReplies) : null;
    const message = next && next.length
      ? { role: 'assistant', content: null, tool_calls: next.map((c, i) => ({ id: `t${round}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
      : { role: 'assistant', content: 'Here is what I found.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const ask = async (headers: any, question: string) => routeAssistant({ method: 'POST', action: 'ask', headers, query: {}, body: { question } });
const act = async (headers: any, action: 'confirm' | 'dismiss', id: string) => routeAssistant({ method: 'POST', action, headers, query: {}, body: { id } });

// 1. an employee is only told about the everyone tools, and a forced call to an HR tool is refused by the server
script([{ name: 'find_employee', args: { query: 'omar' } }, { name: 'get_employee_leave_ledger', args: { uid: 'u_other' } }]);
let r = await ask(EMP, 'Find Omar and show his leave entries');
assert.equal(r.status, 200);
assert.ok(!seenTools.includes('find_employee') && !seenTools.includes('get_leave_exceptions'), `employee was shown HR tools: ${seenTools}`);
assert.ok(seenTools.includes('get_pending_approvals') && seenTools.includes('get_leave_balances'));
assert.equal(toolReplies.length, 2);
assert.ok(toolReplies.every((t) => /Not available/.test(t.error || '')), `HR tools must be refused for an employee: ${JSON.stringify(toolReplies)}`);

// 2. an employee asking for attendance only ever gets their own records
script([{ name: 'get_attendance_summary', args: { from: addDays(istToday(), -6), to: istToday() } }]);
r = await ask(EMP, 'How is attendance?');
assert.equal(toolReplies[0].peopleCount, 1, 'an employee sees only themselves');
assert.equal(toolReplies[0].people[0].name, 'Esha Employee');

// 3. nothing waiting: the approvals tool says so, it does not invent work
script([{ name: 'get_pending_approvals' }]);
r = await ask(EMP, 'What is waiting for me?');
assert.equal(toolReplies[0].leaveRequestsWaiting, 0);
assert.equal(toolReplies[0].note, 'Nothing is waiting for this person.');

// 4. HR sees every tool, can look people up, and sees the whole company's attendance
script([{ name: 'find_employee', args: { query: 'omar' } }, { name: 'get_attendance_summary' }, { name: 'get_leave_exceptions' }, { name: 'get_leave_requests_overview', args: { status: 'bogus' } }]);
r = await ask(HR, 'Find Omar, attendance this week, open exceptions, all requests');
assert.equal(seenTools.length > 8, true);
for (const n of ['find_employee', 'get_employee_leave_ledger', 'get_leave_exceptions', 'get_leave_requests_overview']) assert.ok(seenTools.includes(n), `HR should be shown ${n}`);
assert.equal(toolReplies[0].matches[0].uid, 'u_other');
assert.ok(toolReplies[1].peopleCount >= 3, 'HR sees the whole company');
assert.equal(typeof toolReplies[2].openCount, 'number');
assert.deepEqual(toolReplies[3].filters, {}, 'an unknown status is dropped, not passed on');

// 5. ledger for a person, via the uid HR just found
script([{ name: 'get_employee_leave_ledger', args: { uid: 'u_other' } }, { name: 'get_employee_leave_ledger', args: { uid: 'x" OR 1=1' } }]);
r = await ask(HR, 'Omar ledger');
assert.ok(toolReplies[0].entries.length > 0, 'accrual left ledger entries');
assert.match(toolReplies[1].error, /find_employee/, 'a malformed uid is rejected before any query');

// 6. another company's HR cannot see this company's people (the leave route scopes by the token's company)
script([{ name: 'find_employee', args: { query: 'esha' } }]);
r = await ask(OTHER_CO, 'Find Esha');
assert.equal(toolReplies[0].matches?.length ?? 0, 0, 'no cross-company results');

// ------------------------------------------------------------------ stage 2: propose, confirm, execute once

const nextWed = (() => { let d = addDays(istToday(), 14); while (weekday(d) !== 3) d = addDays(d, 1); return d; })();
const requestsOf = async (uid: string) => (await leave(HR, 'GET', 'all-requests', {}, { uid })).json.items as any[];

// 7. an employee applies for leave through the agent: a card first, nothing saved until Confirm
script([{ name: 'propose_apply_leave', args: { leaveType: 'casual', from: nextWed, to: nextWed, reason: 'Family function' } }]);
r = await ask(EMP, `Apply casual leave on ${nextWed}`);
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
const applyCard = r.json.proposals[0];
assert.match(applyCard.title, /Casual/i);
assert.ok(applyCard.lines.some((l: string) => /Days: 1/.test(l)), `server works out the days: ${applyCard.lines}`);
assert.equal((await requestsOf('u_emp')).length, 0, 'nothing is applied before Confirm');
// someone else cannot confirm it
assert.equal((await act(MGR, 'confirm', applyCard.id)).status, 404, 'only the person it was prepared for can confirm');
assert.equal((await requestsOf('u_emp')).length, 0);
// confirm runs it once, a second click does not apply again
let c1 = await act(EMP, 'confirm', applyCard.id);
assert.equal(c1.json.status, 'DONE', JSON.stringify(c1.json));
const c2 = await act(EMP, 'confirm', applyCard.id);
assert.equal(c2.json.status, 'DONE');
const mine = await requestsOf('u_emp');
assert.equal(mine.length, 1, 'confirming twice applies once');
assert.equal(mine[0].status, 'PENDING');
const leaveId = mine[0].id;

// a bad leave type or date is refused with a reason, not guessed
script([{ name: 'propose_apply_leave', args: { leaveType: 'sabbatical', from: nextWed } }, { name: 'propose_apply_leave', args: { leaveType: 'casual', from: 'tomorrow-ish' } }]);
r = await ask(EMP, 'Apply sabbatical');
assert.equal(r.json.proposals.length, 0);
assert.ok(toolReplies[0].leaveTypes?.length > 0 && /leave type/i.test(toolReplies[0].error));
assert.match(toolReplies[1].error, /dates/i);

// 8. the manager sees it, and cannot be tricked into deciding something that is not theirs
script([() => [{ name: 'get_pending_approvals' }]]);
r = await ask(MGR, 'What is waiting for me?');
assert.equal(toolReplies[0].leaveRequestsWaiting, 1);
assert.equal(toolReplies[0].leaveRequests[0].requestId, leaveId);
assert.equal(toolReplies[0].leaveRequests[0].employee, 'Esha Employee');

script([{ name: 'propose_leave_decision', args: { requestId: leaveId, decision: 'APPROVE' } }]);
r = await ask(EMP, 'Approve my own leave');
assert.equal(r.json.proposals.length, 0, 'an employee cannot propose deciding their own request');
assert.match(toolReplies[0].error, /not waiting/);

script([{ name: 'propose_leave_decision', args: { requestId: 'made-up-id', decision: 'APPROVE' } }, { name: 'propose_leave_decision', args: { requestId: leaveId, decision: 'REJECT' } }]);
r = await ask(MGR, 'Reject it');
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /not waiting/, 'an id that is not in the approvals list is refused');
assert.match(toolReplies[1].error, /reason/i, 'a rejection needs a reason');

// approve: card, then dismiss does nothing, a fresh card then confirms
script([{ name: 'propose_leave_decision', args: { requestId: leaveId, decision: 'APPROVE', comment: 'Enjoy' } }]);
r = await ask(MGR, 'Approve Esha\'s leave');
const dec = r.json.proposals[0];
assert.match(dec.title, /Approve/);
assert.ok(dec.lines.some((l: string) => /Esha Employee/.test(l)));
assert.equal((await requestsOf('u_emp'))[0].status, 'PENDING', 'still pending until the manager confirms');
assert.equal((await act(MGR, 'dismiss', dec.id)).json.status, 'DISMISSED');
assert.equal((await act(MGR, 'confirm', dec.id)).json.status, 'DISMISSED', 'a dismissed card cannot be confirmed');
assert.equal((await requestsOf('u_emp'))[0].status, 'PENDING');

script([{ name: 'propose_leave_decision', args: { requestId: leaveId, decision: 'APPROVE' } }]);
r = await ask(MGR, 'Approve it');
const dec2 = r.json.proposals[0];
// an old card expires
await fdb.collection('agentProposals').doc(dec2.id).update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
assert.equal((await act(MGR, 'confirm', dec2.id)).json.status, 'EXPIRED');
assert.equal((await requestsOf('u_emp'))[0].status, 'PENDING', 'an expired card does nothing');

script([{ name: 'propose_leave_decision', args: { requestId: leaveId, decision: 'APPROVE', comment: 'Enjoy' } }]);
r = await ask(MGR, 'Approve it again');
const dec3 = r.json.proposals[0];
const ok3 = await act(MGR, 'confirm', dec3.id);
assert.equal(ok3.json.status, 'DONE', JSON.stringify(ok3.json));
const afterApprove = (await requestsOf('u_emp'))[0];
const approvals = (afterApprove.events || []).filter((e: any) => /Approved/.test(e.message));
assert.equal(approvals.length, 1, 'approved exactly once');
assert.equal((await act(MGR, 'confirm', dec3.id)).json.status, 'DONE');
assert.equal(((await requestsOf('u_emp'))[0].events || []).filter((e: any) => /Approved/.test(e.message)).length, 1, 'a second confirm does not approve again');
assert.equal((await act(OTHER_CO, 'confirm', dec3.id)).status, 404, 'another company cannot touch it');

// matchLeaveType and proposalLive on their own
assert.equal(matchLeaveType([{ name: 'Casual leave', code: 'CL' }, { name: 'Sick leave', code: 'SL' }], 'cl')?.code, 'CL');
assert.equal(matchLeaveType([{ name: 'Casual leave', code: 'CL' }, { name: 'Sick leave', code: 'SL' }], 'leave'), null, 'an ambiguous name matches nothing');
assert.equal(proposalLive({ status: 'PENDING', expiresAt: new Date(Date.now() + 5000).toISOString() }), true);
assert.equal(proposalLive({ status: 'DONE', expiresAt: new Date(Date.now() + 5000).toISOString() }), false);

globalThis.fetch = realFetch;
console.log('leave agent ok');
