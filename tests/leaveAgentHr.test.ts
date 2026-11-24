import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { raiseException } from '../api/_lib/leaveCore.ts';
import { istToday } from '../shared/leaveEngine.ts';
import {
  ATTENDANCE_BACKFILL_DAYS, BALANCE_MAX_DAYS, LEAVE_AGENT_TOOLS, addDays, attendanceProblem, balanceProblem, cleanTime, toolsFor,
} from '../shared/leaveAgentTools.ts';

// ------------------------------------------------------------------ pure parts

const HR_ONLY = ['propose_mark_attendance', 'propose_resolve_exception', 'propose_adjust_balance'];
const names = (w: any) => toolsFor(w).map((t) => t.name);
for (const n of HR_ONLY) {
  const t = LEAVE_AGENT_TOOLS.find((x) => x.name === n)!;
  assert.equal(t.kind, 'propose', `${n} only proposes`);
  assert.equal(t.access, 'manage', `${n} is for leave managers only`);
  assert.ok(!names({ perms: [] }).includes(n), 'an employee is not told about it');
  assert.ok(!names({ perms: ['leave.report'] }).includes(n), 'report access is not enough');
  assert.ok(!names({ perms: ['lifecycle.manage', 'payroll.manage'] }).includes(n), 'other HR permissions are not enough');
  assert.ok(names({ perms: ['leave.manage'] }).includes(n), 'HR is told about it');
  assert.ok(names({ perms: [], isCompanyAdmin: true }).includes(n), 'a company admin is told about it');
}
assert.ok(LEAVE_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|company_id|cid/)));

assert.equal(cleanTime('09:05'), '09:05');
assert.equal(cleanTime('9:05'), '09:05');
assert.equal(cleanTime(' 18:30 '), '18:30');
for (const bad of ['9am', '24:00', '12:60', '1230', '', undefined, '12:5', '-1:00']) assert.equal(cleanTime(bad), '', `not a time: ${String(bad)}`);

const T = '2026-11-24';
const okAtt = { date: '2026-11-20', checkIn: '09:00', checkOut: '18:00' };
assert.equal(attendanceProblem(okAtt, T), '');
assert.equal(attendanceProblem({ ...okAtt, date: T }, T), '', 'today is allowed');
assert.match(attendanceProblem({ ...okAtt, date: '2026-11-25' }, T), /today or an earlier/);
assert.match(attendanceProblem({ ...okAtt, date: 'soon' }, T), /valid date/);
assert.match(attendanceProblem({ ...okAtt, date: addDays(T, -ATTENDANCE_BACKFILL_DAYS - 1) }, T), /Attendance screen/);
assert.equal(attendanceProblem({ ...okAtt, date: addDays(T, -ATTENDANCE_BACKFILL_DAYS) }, T), '', 'the last allowed day');
assert.match(attendanceProblem({ ...okAtt, checkIn: '' }, T), /both/);
assert.match(attendanceProblem({ ...okAtt, checkOut: '09:00' }, T), /after the check-in/);

assert.equal(balanceProblem(2, 5), '');
assert.equal(balanceProblem(-5, 5), '', 'down to exactly zero is fine');
assert.match(balanceProblem(-5.5, 5), /below zero \(it is 5 days/);
assert.match(balanceProblem(0, 5), /how many days/);
assert.match(balanceProblem(NaN, 5), /how many days/);
assert.match(balanceProblem(BALANCE_MAX_DAYS + 0.5, 5), /at most 30/);
assert.equal(balanceProblem(BALANCE_MAX_DAYS, 5), '');
assert.match(balanceProblem(0.3, 5), /half days/);
assert.equal(balanceProblem(1.5, 0), '');
assert.equal(balanceProblem(2, null), '', 'an unknown balance does not block an addition');

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const HR2 = tokenFor('u_hr2', ['leave.manage', 'leave.report']);
const HR_DEMOTED = tokenFor('u_hr', []);
const ADMIN = tokenFor('u_adm', [], true);
const EMP = tokenFor('u_emp');
const REPORT = tokenFor('u_rep', ['leave.report']);
const OTHER_CO = tokenFor('u_x', ['leave.manage'], false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name, cid] of [['u_hr', 'Hema HR', CID], ['u_hr2', 'Hira HR', CID], ['u_adm', 'Ada Admin', CID], ['u_emp', 'Esha Employee', CID], ['u_other', 'Omar Other', CID], ['u_rep', 'Rita Reporter', CID], ['u_x', 'Xavier Outsider', 'c2']]) {
  fdb.seed('employees', uid, { companyId: cid, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase() });
}
const leave = async (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
assert.equal((await leave(HR, 'POST', 'apply-starter', { yearStartMonth: 4 })).status, 200);
await leave(HR, 'POST', 'save-profiles', { profiles: ['u_hr', 'u_hr2', 'u_adm', 'u_emp', 'u_other', 'u_rep'].map((uid) => ({ uid, joinDate: '2020-01-01' })) });
await leave(HR, 'POST', 'run-accrual');

process.env.OPENAI_API_KEY = 'test-key';
process.env.ASSISTANT_DAILY_LIMIT = '1000';
const realFetch = globalThis.fetch;
let seenTools: string[] = [];
let toolReplies: any[] = [];
type Call = { name: string; args?: any };
const script = (calls: Call[]) => {
  toolReplies = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    const last = body.messages[body.messages.length - 1];
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const message = last.role !== 'tool'
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
      : { role: 'assistant', content: 'Here is what I prepared.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const ask = async (headers: any, question: string) => routeAssistant({ method: 'POST', action: 'ask', headers, query: {}, body: { question } });
const act = async (headers: any, action: 'confirm' | 'dismiss', id: string) => routeAssistant({ method: 'POST', action, headers, query: {}, body: { id } });
const today = istToday();
const day = (uid: string, date: string, headers = HR) => leave(headers, 'GET', 'attendance-report', {}, { from: date, to: date, uid }).then((x) => x.json.people[0].days[0]);
const balanceOf = async (uid: string, type = 'cl') => (await leave(HR, 'GET', 'report-balances')).json.rows.find((x: any) => x.uid === uid).balances[type] as number;
const audits = async (entity: string) => (await leave(HR, 'GET', 'audit-log', {}, { entity })).json.items as any[];
const lastProposal = async (id: string) => (await fdb.collection('agentProposals').doc(id).get()).data() as any;

// 1. nobody but HR and admin is even told about these tools, and a forced call is refused by the server
for (const [who, label] of [[EMP, 'employee'], [REPORT, 'report-only']] as const) {
  script([
    { name: 'propose_mark_attendance', args: { uid: 'u_other', date: addDays(today, -2), checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to punch' } },
    { name: 'propose_adjust_balance', args: { uid: 'u_emp', leaveType: 'casual', days: 5, reason: 'Gift' } },
    { name: 'propose_resolve_exception', args: { exceptionId: 'x', resolution: 'fine' } },
  ]);
  const r = await ask(who, 'Do the HR things');
  assert.equal(r.status, 200);
  for (const n of HR_ONLY) assert.ok(!seenTools.includes(n), `${label} was shown ${n}`);
  assert.equal(toolReplies.length, 3);
  assert.ok(toolReplies.every((t) => /Not available/.test(t.error || '')), `${label}: ${JSON.stringify(toolReplies)}`);
  assert.equal(r.json.proposals.length, 0);
}
assert.equal((await day('u_other', addDays(today, -2))).checkIn, null, 'nothing was recorded');
assert.equal((await fdb.collection('agentProposals').get()).docs.length, 0, 'no proposal was even saved');

// 2. HR sees all three tools; marking attendance is propose, then confirm, once
const d1 = addDays(today, -3);
const markArgs = { uid: 'u_emp', date: d1, checkIn: '9:30', checkOut: '18:00', reason: 'Forgot to punch in, confirmed by manager' };
script([{ name: 'propose_mark_attendance', args: markArgs }]);
let r = await ask(HR, 'Mark Esha present');
for (const n of HR_ONLY) assert.ok(seenTools.includes(n), `HR should be shown ${n}`);
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
const markCard = r.json.proposals[0];
assert.match(markCard.title, /Esha Employee/);
assert.ok(markCard.lines.some((l: string) => /^Recorded now:/.test(l)), markCard.lines.join(' | '));
assert.ok(markCard.lines.some((l: string) => /in 09:30, out 18:00/.test(l)), 'times are cleaned to HH:MM');
assert.ok(markCard.lines.some((l: string) => /Forgot to punch in/.test(l)));
assert.equal((await day('u_emp', d1)).checkIn, null, 'nothing recorded before Confirm');
assert.equal((await act(HR2, 'confirm', markCard.id)).status, 404, 'only the person it was prepared for can confirm');
assert.equal((await act(EMP, 'confirm', markCard.id)).status, 404);
const m1 = await act(HR, 'confirm', markCard.id);
assert.equal(m1.json.status, 'DONE', JSON.stringify(m1.json));
const rec = await day('u_emp', d1);
assert.equal(rec.checkIn, '09:30');
assert.equal(rec.checkOut, '18:00');
assert.equal(rec.source, 'HR');
assert.match(rec.note, /^Via Ask HR: Forgot to punch in/);
assert.equal((await act(HR, 'confirm', markCard.id)).json.status, 'DONE');
const attAudit = (await audits('leave-attendance')).filter((a) => a.entityId === 'u_emp');
assert.equal(attAudit.length, 1, 'one audit entry, even after a second click');
assert.equal(attAudit[0].action, 'ATTENDANCE_MARKED_ASK_HR');
assert.equal(attAudit[0].actorUid, 'u_hr');
assert.equal((await lastProposal(markCard.id)).status, 'DONE');

// 3. attendance: every rule is enforced before a card exists
const bad = async (args: any, re: RegExp, who = HR) => {
  script([{ name: 'propose_mark_attendance', args: { ...markArgs, date: addDays(today, -4), ...args } }]);
  const x = await ask(who, 'Mark attendance');
  assert.equal(x.json.proposals.length, 0, `a card was made for ${JSON.stringify(args)}`);
  assert.match(toolReplies[0].error || '', re, JSON.stringify(toolReplies[0]));
};
await bad({ uid: 'u_hr' }, /own record/);
await bad({ uid: 'u_hr' }, /own record/, tokenFor('u_hr', [], true));
await bad({ reason: '' }, /reason is needed/);
await bad({ checkIn: '9am' }, /both the check-in/);
await bad({ checkOut: '08:00' }, /after the check-in/);
await bad({ date: addDays(today, 1) }, /today or an earlier/);
await bad({ date: addDays(today, -ATTENDANCE_BACKFILL_DAYS - 5) }, /Attendance screen/);
await bad({ date: 'last friday' }, /valid date/);
await bad({ uid: 'u_nobody' }, /No employee/);
await bad({ uid: 'u_emp" OR 1=1' }, /find_employee/);
await bad({ uid: 'u_x' }, /No employee/, HR); // a person of another company is not found

// 4. a locked payroll month is refused, also when it locks after the card was made
const d2 = addDays(today, -6);
fdb.seed('payrollRuns', 'run-locked', { companyId: CID, month: d2.slice(0, 7), status: 'LOCKED' });
await bad({ date: d2 }, /locked/);
fdb.seed('payrollRuns', 'run-locked', { companyId: CID, month: d2.slice(0, 7), status: 'DRAFT' });
script([{ name: 'propose_mark_attendance', args: { ...markArgs, date: d2 } }]);
r = await ask(HR, 'Mark attendance');
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
fdb.seed('payrollRuns', 'run-locked', { companyId: CID, month: d2.slice(0, 7), status: 'LOCKED' });
const late = await act(HR, 'confirm', r.json.proposals[0].id);
assert.equal(late.json.status, 'FAILED');
assert.match(late.json.message, /locked/);
assert.equal((await day('u_emp', d2)).checkIn, null, 'a locked month was not touched');
fdb.seed('payrollRuns', 'run-locked', { companyId: CID, month: d2.slice(0, 7), status: 'DRAFT' });

// 5. balance: the card shows before and after, nothing moves until Confirm, and Confirm moves it once
const before = await balanceOf('u_emp');
script([{ name: 'propose_adjust_balance', args: { uid: 'u_emp', leaveType: 'casual', days: 2, reason: 'Worked on Diwali weekend' } }]);
r = await ask(HR, 'Add 2 casual days to Esha');
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
const addCard = r.json.proposals[0];
assert.match(addCard.title, /Add 2 days: Casual leave, Esha Employee/);
assert.ok(addCard.lines.includes(`Balance now: ${before} days`), addCard.lines.join(' | '));
assert.ok(addCard.lines.includes(`Balance after: ${Math.round((before + 2) * 100) / 100} days`), addCard.lines.join(' | '));
assert.ok(!addCard.destructive, 'adding days is not a red button');
assert.equal(await balanceOf('u_emp'), before, 'unchanged before Confirm');
assert.equal((await act(HR, 'confirm', addCard.id)).json.status, 'DONE');
assert.equal((await act(HR, 'confirm', addCard.id)).json.status, 'DONE');
assert.equal(await balanceOf('u_emp'), Math.round((before + 2) * 100) / 100, 'posted exactly once');
const balAudit = (await audits('leave-balance')).filter((a) => a.entityId === 'u_emp');
assert.equal(balAudit.length, 1);
assert.equal(balAudit[0].action, 'BALANCE_ADJUSTED');
assert.equal(balAudit[0].actorUid, 'u_hr');
assert.match((await leave(HR, 'GET', 'balances-of', {}, { uid: 'u_emp' })).json.items.find((e: any) => e.kind === 'ADJUST').note, /^Via Ask HR: Worked on Diwali/);

// 6. balance: every rule is enforced before a card exists
const now = await balanceOf('u_emp');
const badBal = async (args: any, re: RegExp, who = HR) => {
  script([{ name: 'propose_adjust_balance', args: { uid: 'u_emp', leaveType: 'casual', days: 1, reason: 'Because', ...args } }]);
  const x = await ask(who, 'Adjust balance');
  assert.equal(x.json.proposals.length, 0, `a card was made for ${JSON.stringify(args)}`);
  assert.match(toolReplies[0].error || '', re, JSON.stringify(toolReplies[0]));
  return toolReplies[0];
};
await badBal({ uid: 'u_hr' }, /own record/);
await badBal({ reason: '' }, /reason is needed/);
await badBal({ days: 0 }, /how many days/);
await badBal({ days: 'lots' }, /how many days/);
await badBal({ days: BALANCE_MAX_DAYS + 1 }, /at most 30/);
await badBal({ days: 0.3 }, /half days/);
await badBal({ days: -(Math.ceil((now + 1) * 2) / 2) }, /below zero/);
const unknownType = await badBal({ leaveType: 'sabbatical' }, /leave type/i);
assert.ok(unknownType.leaveTypes.length > 0, 'the real leave types are listed so the model can ask');
await badBal({ uid: 'u_nobody' }, /No active employee/);
await badBal({ uid: 'u_x' }, /No active employee/);
assert.equal(await balanceOf('u_emp'), now, 'no refusal changed anything');

// 7. a deduction is checked again at Confirm: the balance may have changed since the card was made
script([{ name: 'propose_adjust_balance', args: { uid: 'u_emp', leaveType: 'casual', days: -1, reason: 'Taken without applying' } }]);
r = await ask(HR, 'Deduct 1 casual day');
const dedCard = r.json.proposals[0];
assert.equal(dedCard.destructive, true);
assert.match(dedCard.title, /Deduct 1 day/);
assert.equal((await leave(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'cl', delta: -now, note: 'Direct fix on the screen' })).status, 200);
const failed = await act(HR, 'confirm', dedCard.id);
assert.equal(failed.json.status, 'FAILED');
assert.match(failed.json.message, /below zero.*Nothing was changed/);
assert.equal(Math.abs(await balanceOf('u_emp')) < 0.01, true, 'only the direct fix moved the balance');
assert.equal((await lastProposal(dedCard.id)).status, 'FAILED');

// 8. losing the permission between card and Confirm: the leave route refuses and nothing changes
script([{ name: 'propose_adjust_balance', args: { uid: 'u_other', leaveType: 'casual', days: 1, reason: 'Goodwill' } }]);
r = await ask(HR, 'Add a day for Omar');
const otherBefore = await balanceOf('u_other');
const demoted = await act(HR_DEMOTED, 'confirm', r.json.proposals[0].id);
assert.equal(demoted.json.status, 'FAILED', JSON.stringify(demoted.json));
assert.equal(await balanceOf('u_other'), otherBefore, 'a person without the permission cannot execute a stale card');

// 9. a company admin can do it too; another company cannot touch the card
script([{ name: 'propose_adjust_balance', args: { uid: 'u_other', leaveType: 'casual', days: 1, reason: 'Goodwill' } }]);
r = await ask(ADMIN, 'Add a day for Omar');
assert.ok(seenTools.includes('propose_adjust_balance'), 'an admin is shown the tool');
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
assert.equal((await act(OTHER_CO, 'confirm', r.json.proposals[0].id)).status, 404);
assert.equal((await act(ADMIN, 'confirm', r.json.proposals[0].id)).json.status, 'DONE');
assert.equal(await balanceOf('u_other'), Math.round((otherBefore + 1) * 100) / 100);
script([{ name: 'propose_adjust_balance', args: { uid: 'u_adm', leaveType: 'casual', days: 1, reason: 'Self-serve' } }]);
r = await ask(ADMIN, 'Add a day for me');
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /own record/, 'an admin cannot adjust their own balance either');

// defence in depth: even a proposal that somehow points at the approver's own record is refused at Confirm
const hrBalance = await balanceOf('u_hr');
const plant = (id: string, action: string, params: any) => fdb.seed('agentProposals', id, {
  id, companyId: CID, uid: 'u_hr', action, params, title: 'planted', lines: [], status: 'PENDING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
plant('planted-bal', 'balance_adjust', { uid: 'u_hr', typeId: 'cl', typeName: 'Casual leave', delta: 5, note: 'Self', employee: 'Hema HR' });
plant('planted-att', 'attendance_mark', { uid: 'u_hr', date: addDays(today, -2), checkIn: '09:00', checkOut: '18:00', reason: 'Self', employee: 'Hema HR' });
for (const id of ['planted-bal', 'planted-att']) {
  const x = await act(HR, 'confirm', id);
  assert.equal(x.json.status, 'FAILED', `${id}: ${JSON.stringify(x.json)}`);
  assert.match(x.json.message, /own record/);
}
assert.equal(await balanceOf('u_hr'), hrBalance, 'the planted proposal moved nothing');
assert.equal((await day('u_hr', addDays(today, -2))).checkIn, null);

// 10. exceptions: the agent is given the id, closing needs a resolution, and your own is off limits
await raiseException(CID, { category: 'NO_POLICY', message: 'Omar Other has no valid leave policy.', uid: 'u_other' });
await raiseException(CID, { category: 'NO_MANAGER', message: 'Hema HR has no manager.', uid: 'u_hr' });
script([{ name: 'get_leave_exceptions' }]);
await ask(HR, 'Open exceptions');
const open = toolReplies[0].items as any[];
const omar = open.find((x) => x.category === 'NO_POLICY');
const own = open.find((x) => x.category === 'NO_MANAGER');
assert.ok(omar.exceptionId && omar.canResolve === true, JSON.stringify(omar));
const openBefore = toolReplies[0].openCount;

const badEx = async (args: any, re: RegExp, who = HR) => {
  script([{ name: 'propose_resolve_exception', args }]);
  const x = await ask(who, 'Close it');
  assert.equal(x.json.proposals.length, 0, `a card was made for ${JSON.stringify(args)}`);
  assert.match(toolReplies[0].error || '', re, JSON.stringify(toolReplies[0]));
};
await badEx({ exceptionId: omar.exceptionId, resolution: '' }, /how it was resolved/);
await badEx({ exceptionId: 'made-up-id', resolution: 'Done' }, /not an open exception/);
await badEx({ exceptionId: own.exceptionId, resolution: 'Fixed' }, /own record/);

script([{ name: 'propose_resolve_exception', args: { exceptionId: omar.exceptionId, resolution: 'Assigned the Standard policy' } }]);
r = await ask(HR, 'Close the Omar exception, I assigned the Standard policy');
assert.equal(r.json.proposals.length, 1, JSON.stringify(toolReplies));
const exCard = r.json.proposals[0];
assert.match(exCard.title, /Close exception: no policy, Omar Other/);
assert.ok(exCard.lines.some((l: string) => /Assigned the Standard policy/.test(l)));
assert.equal(((await fdb.collection('leaveExceptions').doc(omar.exceptionId).get()).data() as any).status, 'OPEN', 'still open before Confirm');
assert.equal((await act(HR, 'confirm', exCard.id)).json.status, 'DONE');
assert.equal((await act(HR, 'confirm', exCard.id)).json.status, 'DONE');
const closed = (await fdb.collection('leaveExceptions').doc(omar.exceptionId).get()).data() as any;
assert.deepEqual([closed.status, closed.resolution, closed.resolvedBy], ['RESOLVED', 'Assigned the Standard policy', 'Hema HR']);
assert.equal((await audits('leave-exception')).filter((a) => a.entityId === omar.exceptionId).length, 1);
script([{ name: 'get_leave_exceptions' }]);
await ask(HR, 'Open exceptions');
assert.equal(toolReplies[0].openCount, openBefore - 1);
await badEx({ exceptionId: omar.exceptionId, resolution: 'Again' }, /not an open exception/);

// a payroll flag is not visible to leave HR, so the agent cannot be pointed at it
fdb.seed('leaveExceptions', 'flag-pay', { id: 'flag-pay', companyId: CID, category: 'FLAG_PAYROLL', severity: 'HIGH', message: 'Net pay jumped 80%', requestId: '', uid: 'u_other', assignedTo: 'HR', status: 'OPEN', createdAt: new Date().toISOString() });
await badEx({ exceptionId: 'flag-pay', resolution: 'Looks right' }, /not an open exception/);

globalThis.fetch = realFetch;
console.log('leave agent hr actions ok');
