import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { istToday } from '../shared/leaveEngine.ts';
import {
  LEAVE_AGENT_TOOLS, addDays, cleanRange, cleanUid, countBy, matchEmployees, mayUseTool, roleLine, summarizeAttendance, toolsFor,
} from '../shared/leaveAgentTools.ts';

// ------------------------------------------------------------------ pure parts

const names = (w: any) => toolsFor(w).map((t) => t.name);
assert.deepEqual(names({ perms: [] }), ['get_pending_approvals', 'get_team_calendar', 'get_attendance_summary'], 'an employee gets the everyone tools only');
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
const OTHER_CO = { authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'u_x', email: 'x@other.com', cid: 'c2', cs: 'ACTIVE', perms: ['leave.manage'], adm: false })).toString('base64')}` };

fdb.seed('companies', CID, { name: 'Acme Ltd' });
fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name, cid] of [['u_hr', 'Hema HR', CID], ['u_emp', 'Esha Employee', CID], ['u_other', 'Omar Other', CID], ['u_x', 'Xavier Outsider', 'c2']]) {
  fdb.seed('employees', uid, { companyId: cid, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
const leave = async (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
assert.equal((await leave(HR, 'POST', 'apply-starter', { yearStartMonth: 4 })).status, 200);
await leave(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_emp', joinDate: '2020-01-01' }, { uid: 'u_other', joinDate: '2020-01-01' }, { uid: 'u_hr', joinDate: '2020-01-01' }] });
await leave(HR, 'POST', 'run-accrual');

// A scripted "model": the first reply asks for the given tool calls, the next one answers with a fixed sentence.
process.env.OPENAI_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
let seenTools: string[] = [];
let toolReplies: any[] = [];
const script = (calls: { name: string; args?: any }[]) => {
  toolReplies = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    const last = body.messages[body.messages.length - 1];
    let message: any;
    if (last.role === 'tool') {
      toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
      message = { role: 'assistant', content: 'Here is what I found.' };
    } else {
      message = { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) };
    }
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const ask = async (headers: any, question: string) => routeAssistant({ method: 'POST', action: 'ask', headers, query: {}, body: { question } });

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

globalThis.fetch = realFetch;
console.log('leave agent ok');
