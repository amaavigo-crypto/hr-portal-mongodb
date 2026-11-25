import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLifecycle } from '../api/_lib/lifecycleApi.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { buildDigests } from '../shared/agentWatcher.ts';
import {
  EMPLOYEE_AGENT_TOOLS, checkProfileChanges, employeeToolsFor, filterPeople, gapsOf, reviewQueue, selfStatus, summarizeCompleteness, type PersonRow,
} from '../shared/employeeAgentTools.ts';

// ------------------------------------------------------------------ pure parts

const row = (o: Partial<PersonRow> = {}): PersonRow => ({
  uid: 'a', name: 'Asha', empId: 'E1', department: 'Ops', title: 'Analyst', joinDate: '2026-01-10', mobile: '9999999999',
  identity: { PAN: { status: 'APPROVED', hasNumber: true, numberMasked: 'XXXXXX234F' }, AADHAAR: { status: 'APPROVED', hasNumber: true, numberMasked: 'XXXXXXXX1234' } },
  qualifications: 1, family: 1, personal: true, ...o,
});
assert.deepEqual(gapsOf(row()), [], 'a full record has no gaps');
assert.deepEqual(gapsOf(row({ mobile: '', qualifications: 0, personal: false })), ['MOBILE', 'QUALIFICATION', 'PERSONAL']);
assert.deepEqual(gapsOf(row({ identity: { PAN: { status: 'PENDING', hasNumber: false, pendingMasked: 'XXXXXX234F' } } })), ['AADHAAR'], 'a PAN waiting for HR is not a gap');
assert.deepEqual(gapsOf(row({ identity: { PAN: { status: 'REJECTED', hasNumber: false, note: 'blurry' }, AADHAAR: { status: '', hasNumber: false } } })), ['PAN', 'AADHAAR']);

const people = [
  row({ uid: '1', name: 'Zed', department: 'Sales', joinDate: '2026-02-01' }),
  row({ uid: '2', name: 'Amy', department: 'Ops', mobile: '', family: 0, joinDate: '2026-03-05' }),
  row({ uid: '3', name: 'Bob', department: 'Ops', joinDate: '2026-03-20', identity: { PAN: { status: 'PENDING', hasNumber: false, pendingMasked: 'XXXXXX999Z', pendingSince: '2026-11-10' }, AADHAAR: { status: 'APPROVED', hasNumber: true } } }),
];
assert.deepEqual(filterPeople(people, { department: 'ops' }).map((p) => p.name), ['Amy', 'Bob']);
assert.deepEqual(filterPeople(people, { missing: 'MOBILE' }).map((p) => p.name), ['Amy']);
assert.deepEqual(filterPeople(people, { pendingReview: true }).map((p) => p.name), ['Bob']);
assert.deepEqual(filterPeople(people, { joinedFrom: '2026-03-01', joinedTo: '2026-03-31' }).map((p) => p.name), ['Amy', 'Bob']);
assert.deepEqual(filterPeople(people, { query: 'zed' }).map((p) => p.name), ['Zed']);
const comp = summarizeCompleteness(people);
assert.deepEqual([comp.people, comp.complete, comp.incomplete, comp.identityDocumentsWaiting], [3, 2, 1, 1]);
assert.equal(comp.missingByDetail['Mobile number'], 1);
assert.equal(comp.mostGaps[0].name, 'Amy');
const q = reviewQueue(people, '2026-11-24');
assert.deepEqual([q.waiting, q.items[0].daysWaiting, q.items[0].newNumber], [1, 14, 'XXXXXX999Z']);
assert.ok(!JSON.stringify(selfStatus(people[2])).includes('999Z') || JSON.stringify(selfStatus(people[2])).includes('XXXXXX999Z'), 'only masked numbers');

assert.equal(checkProfileChanges({ department: 'Sales' }, '2026-11-24').error?.includes('cannot be changed'), true);
assert.ok(checkProfileChanges({ dob: '2999-01-01' }, '2026-11-24').error);
assert.ok(checkProfileChanges({ mobile: 'abc' }, '2026-11-24').error);
assert.ok(checkProfileChanges({ gender: 'x' }, '2026-11-24').error);
assert.ok(checkProfileChanges({}, '2026-11-24').error);
assert.deepEqual(checkProfileChanges({ mobile: ' 98765 43210 ', joinDate: '2026-04-01' }, '2026-11-24').changes, { mobile: '98765 43210', joinDate: '2026-04-01' });

const names = (w: any) => employeeToolsFor(w).map((t) => t.name);
assert.deepEqual(names({ perms: [] }), ['get_my_profile_status']);
assert.equal(names({ perms: ['lifecycle.manage'] }).length, EMPLOYEE_AGENT_TOOLS.length);
assert.equal(names({ perms: ['leave.manage'] }).length, 1, 'leave.manage is not lifecycle.manage');
assert.ok(EMPLOYEE_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|company_id|cid/)), 'no tool takes a company argument');
assert.ok(EMPLOYEE_AGENT_TOOLS.filter((t) => t.kind === 'propose').every((t) => t.access === 'manage'), 'employees cannot propose any change');

// watcher
const dg = buildDigests({
  today: '2026-11-24', people: [{ uid: 'hr', name: 'Hema', email: 'h@x' }, { uid: 'e', name: 'Esha', email: 'e@x' }, { uid: 'n', name: 'Nia', email: 'n@x' }], hrUids: ['hr'], leaves: [], exceptions: [], exits: [], tasks: [],
  records: [
    { uid: 'e', name: 'Esha', joinDate: '2026-01-01', missing: ['PAN', 'Family details'], rejected: [{ document: 'Aadhaar', reason: 'blurry photo' }], pending: [{ document: 'Passport', submittedDay: '2026-11-10' }] },
    { uid: 'n', name: 'Nia', joinDate: '2026-11-20', missing: ['PAN', 'Aadhaar'], rejected: [], pending: [{ document: 'PAN', submittedDay: '2026-11-23' }] },
  ],
});
const hrD = dg.find((d) => d.uid === 'hr')!;
assert.ok(hrD.sections.some((s) => /waiting for your review \(1\)/.test(s.heading)), 'only the document waiting longer than 3 days');
assert.ok(hrD.sections.some((s) => /Incomplete employee record \(1\)/.test(s.heading)), 'Nia is inside the 14 day grace period');
const eD = dg.find((d) => d.uid === 'e')!;
assert.equal(eD.sections.find((s) => /attention/.test(s.heading))!.lines.length, 1, 'only the rejected document; a missing PAN is HR\'s list, not an email to the employee');
assert.ok(!dg.some((d) => d.uid === 'n'), 'a new joiner inside the grace period is not nudged');

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['lifecycle.manage']);
const EMP = tokenFor('u_emp');
const OTHER = tokenFor('u_other');
const FOREIGN = tokenFor('u_hr', ['lifecycle.manage'], false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_emp', 'Esha Employee'], ['u_other', 'Omar Other']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase(), title: 'Staff' });
  fdb.seed('leaveProfiles', `${CID}__${uid}`, { uid, companyId: CID, joinDate: '2022-03-01' });
}
const longAgo = new Date(Date.now() - 6 * 86400000).toISOString();
fdb.seed('employeeIdentities', `${CID}__u_emp__PAN`, { companyId: CID, uid: 'u_emp', type: 'PAN', number: 'ABCDE1234F', pendingNumber: '', status: 'APPROVED', note: '', updatedAt: longAgo, updatedBy: 'u_emp' });
fdb.seed('employeeIdentities', `${CID}__u_emp__AADHAAR`, { companyId: CID, uid: 'u_emp', type: 'AADHAAR', number: '', pendingNumber: '123412341234', status: 'PENDING', note: '', updatedAt: longAgo, updatedBy: 'u_emp' });
fdb.seed('employeeIdentities', `${CID}__u_other__PAN`, { companyId: CID, uid: 'u_other', type: 'PAN', number: '', pendingNumber: '', status: 'REJECTED', note: 'blurry photo', updatedAt: longAgo, updatedBy: 'u_hr' });

const life = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLifecycle({ method, action, headers, body, query });

process.env.OPENAI_API_KEY = 'test-key';
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
const tools = async (headers: any, calls: Call[]) => { script(calls); return ask(headers, 'Please check'); };

// 1. an employee sees only their own record, masked; HR tools are neither offered nor usable
let r = await tools(EMP, [{ name: 'get_my_profile_status' }, { name: 'find_employees' }, { name: 'propose_profile_change', args: { uid: 'u_emp', changes: { mobile: '9876543210' } } }]);
assert.ok(seenTools.includes('get_my_profile_status') && !seenTools.includes('find_employees') && !seenTools.includes('propose_identity_decision'), `EMP was shown: ${seenTools}`);
const me = toolReplies[0];
assert.equal(me.complete, false);
assert.ok(me.missing.includes('Mobile number') && me.missing.includes('Qualification'));
assert.equal(me.documentsWaitingForHr, 1);
assert.equal(me.identity.find((d: any) => d.type === 'AADHAAR').status, 'waiting for HR');
assert.match(toolReplies[1].error, /Not available/);
assert.match(toolReplies[2].error, /Not available/);
assert.equal(r.json.proposals.length, 0);
const all = JSON.stringify(toolReplies);
assert.ok(!all.includes('ABCDE1234F') && !all.includes('123412341234'), 'a full number never reaches the model');
assert.match(all, /234F/, 'the masked number does');
// the route itself only ever returns the caller\'s own row to a non-HR person
assert.equal((await life(EMP, 'GET', 'people-review')).json.rows.length, 1);
assert.equal((await life(HR, 'GET', 'people-review')).json.rows.length, 3);
assert.equal((await life(HR, 'GET', 'people-review', {}, { self: '1' })).json.rows.length, 1);

// 2. HR search, completeness and review queue
r = await tools(HR, [{ name: 'find_employees', args: { missing: 'MOBILE' } }, { name: 'get_profile_completeness' }, { name: 'get_identity_review_queue' }, { name: 'get_employee_profile', args: { uid: 'u_other' } }]);
assert.equal(toolReplies[0].count, 3);
assert.equal(toolReplies[1].people, 3);
assert.equal(toolReplies[2].waiting, 1);
assert.equal(toolReplies[2].items[0].uid, 'u_emp');
assert.equal(toolReplies[2].items[0].daysWaiting, 6);
assert.equal(toolReplies[3].identity.find((d: any) => d.type === 'PAN').hrReason, 'blurry photo');
assert.ok(!JSON.stringify(toolReplies).includes('123412341234'));
r = await tools(FOREIGN, [{ name: 'get_profile_completeness' }]);
assert.equal(toolReplies[0].people, 0, 'another company sees none of these people');

// 3. identity decision: card first, reason for a rejection, only HR, only what is waiting, once
r = await tools(HR, [{ name: 'propose_identity_decision', args: { uid: 'u_emp', type: 'AADHAAR', decision: 'REJECT' } }, { name: 'propose_identity_decision', args: { uid: 'u_emp', type: 'PAN', decision: 'APPROVE' } }]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /reason/i);
assert.match(toolReplies[1].error, /nothing waiting/i);
r = await tools(HR, [{ name: 'propose_identity_decision', args: { uid: 'u_emp', type: 'AADHAAR', decision: 'REJECT', note: 'Photo is unclear' } }]);
assert.equal(r.json.proposals.length, 1);
const idCard = r.json.proposals[0];
assert.equal(idCard.destructive, true);
assert.ok(idCard.lines.some((l: string) => l.includes('XXXXXXXX1234')) && !JSON.stringify(idCard).includes('123412341234'), 'the card shows only the masked number');
const idStatus = async () => (await life(EMP, 'GET', 'identity')).json.items.find((i: any) => i.type === 'AADHAAR').status;
assert.equal(await idStatus(), 'PENDING', 'nothing changes before Confirm');
assert.equal((await act(OTHER, 'confirm', idCard.id)).status, 404, 'only the person it was prepared for can confirm');
assert.equal((await act(HR, 'confirm', idCard.id)).json.status, 'DONE');
assert.equal(await idStatus(), 'REJECTED');
assert.equal((await act(HR, 'confirm', idCard.id)).json.status, 'DONE', 'a second click is harmless');
r = await tools(HR, [{ name: 'propose_identity_decision', args: { uid: 'u_emp', type: 'AADHAAR', decision: 'APPROVE' } }]);
assert.match(toolReplies[0].error, /nothing waiting/i, 'it is not waiting any more');
r = await tools(EMP, [{ name: 'get_my_profile_status' }]);
assert.equal(toolReplies[0].identity.find((d: any) => d.type === 'AADHAAR').hrReason, 'Photo is unclear', 'the employee sees why');

// 4. profile change: validated, shown before and after, saved only on Confirm
r = await tools(HR, [
  { name: 'propose_profile_change', args: { uid: 'u_emp', changes: { department: 'Sales' } } },
  { name: 'propose_profile_change', args: { uid: 'u_emp', changes: { dob: 'yesterday' } } },
  { name: 'propose_profile_change', args: { uid: 'nobody', changes: { mobile: '9876543210' } } },
]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].error, /cannot be changed/);
assert.match(toolReplies[1].error, /YYYY-MM-DD/);
assert.match(toolReplies[2].error, /not found/i);
r = await tools(HR, [{ name: 'propose_profile_change', args: { uid: 'u_emp', changes: { mobile: '98765 43210', joinDate: '2022-04-01' } } }]);
assert.equal(r.json.proposals.length, 1);
const pc = r.json.proposals[0];
assert.ok(pc.lines.some((l: string) => /Joining date: 2022-03-01 → 2022-04-01/.test(l)), JSON.stringify(pc.lines));
const mobileOf = async () => (await life(HR, 'GET', 'profile', {}, { uid: 'u_emp' })).json.profile.mobile;
assert.equal(await mobileOf(), '');
assert.equal((await act(HR, 'confirm', pc.id)).json.status, 'DONE');
assert.equal(await mobileOf(), '98765 43210');
assert.equal((await life(HR, 'GET', 'profile', {}, { uid: 'u_emp' })).json.profile.joinDate, '2022-04-01');
r = await tools(HR, [{ name: 'propose_profile_change', args: { uid: 'u_emp', changes: { mobile: '98765 43210' } } }]);
assert.equal(r.json.proposals.length, 0);
assert.match(toolReplies[0].note, /already/);

console.log('employee agent tests passed');
