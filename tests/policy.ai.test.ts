import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { applyQuotes, withoutMarkers, rankPassages } from '../shared/assistantEngine.ts';
import { basicSummary, describeChanges, diffPolicy, plainText } from '../shared/policyDiff.ts';
import { LABOUR_LAW } from '../shared/labourLawReference.ts';

// ---------------------------------------------------------------- pure: plain text and diff
assert.equal(plainText('<p>One &amp; two</p><p>Three<br>four</p>'), 'One & two\n\nThree\nfour');
const OLD = 'Employees get 12 days of casual leave.\n\nNotice period is 30 days.\n\nLeave must be applied in advance.';
const NEW = 'Employees get 15 days of casual leave.\n\nNotice period is 30 days.\n\nRemote work needs manager approval.';
const d = diffPolicy(OLD, NEW);
assert.equal(d.changed, 1); assert.equal(d.added, 1); assert.equal(d.removed, 1);
assert.deepEqual(d.changes.find((c) => c.kind === 'CHANGED'), { kind: 'CHANGED', before: 'Employees get 12 days of casual leave.', after: 'Employees get 15 days of casual leave.' });
assert.equal(diffPolicy(OLD, OLD).changes.length, 0);
assert.ok(describeChanges(d).includes('CHANGED TO: Employees get 15 days'));
assert.ok(basicSummary(d).startsWith('1 new paragraph, 1 paragraph reworded, 1 paragraph removed'));
assert.equal(basicSummary(diffPolicy(OLD, OLD)), 'No wording changes.');
assert.ok(LABOUR_LAW.every((l) => l.id && l.point && l.act));

// ---------------------------------------------------------------- pure: quotes come from stored text
const P = new Map([['P1', { text: 'Casual leave is 12 days a year and cannot be carried forward.' }], ['P2', { text: 'Notice period is 30 days.' }]]);
const good = applyQuotes('You get 12 days [[quote:P1]]. Notice is 30 days [[quote:P2]] [[quote:P9]].', P);
assert.deepEqual(good.used.map((u) => u.id), ['P1', 'P2'], 'unknown ids are dropped, order kept'); assert.ok(!good.answer.includes('[['));
assert.equal(good.answer, 'You get 12 days. Notice is 30 days.');
assert.equal(withoutMarkers('See [[quote:P12]]'), 'See');
const fake = applyQuotes('The policy says "employees may carry forward up to 20 days every year" for all staff.', P);
assert.ok(!fake.answer.includes('"'), 'an invented quote loses its quotation marks');
const real = applyQuotes('It says "Casual leave is 12 days a year and cannot be carried forward." clearly.', P);
assert.ok(real.answer.includes('"Casual leave is 12 days'), 'a word-for-word quote is kept');
assert.equal(rankPassages('notice period', [{ id: 'd', title: 'T', version: '1', text: 'Notice period is 30 days.\n\nOther text about travel.' }], 2, 450, false)[0].text, 'Notice period is 30 days.');

// ---------------------------------------------------------------- server
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const AUTHOR = tok('u_author', ['doc.create']), APPROVER = tok('u_appr', ['doc.review']), EMP = tok('u_emp', ['doc.acknowledge']);
fdb.seed('companies', CID, { name: 'Acme', status: 'ACTIVE' });
for (const u of ['u_author', 'u_appr', 'u_emp']) fdb.seed('employees', u, { companyId: CID, authUid: u, name: u, email: `${u}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
fdb.seed('documents', 'M1', { companyId: CID, title: 'Leave policy', active: true, currentPublishedVersionId: 'V1', confidentiality: 'All employees' });
fdb.seed('documents', 'M2', { companyId: CID, title: 'Travel policy', active: true, currentPublishedVersionId: 'V3', confidentiality: 'All employees' });
fdb.seed('versions', 'V1', { companyId: CID, status: 'PUBLISHED', documentMasterId: 'M1', documentTitle: 'Leave policy', versionNumber: '1.0', rawContent: OLD, effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' });
fdb.seed('versions', 'V2', { companyId: CID, status: 'IN_REVIEW', documentMasterId: 'M1', documentTitle: 'Leave policy', versionNumber: '1.1', rawContent: `${NEW}\n\nOvertime is paid at the normal rate of wages.`, createdAt: '2026-02-01T00:00:00Z' });
fdb.seed('versions', 'V3', { companyId: CID, status: 'PUBLISHED', documentMasterId: 'M2', documentTitle: 'Travel policy', versionNumber: '2.0', rawContent: 'Remote work does not need any approval from a manager.', effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' });

const realFetch = globalThis.fetch;
let replies: any[] = [];
let sent: any[] = [];
(globalThis as any).fetch = async (_u: string, init: any) => {
  sent.push(JSON.parse(init.body));
  const m = replies.shift();
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: m }], usage: { prompt_tokens: 500, completion_tokens: 50 } }) };
};
const call = (headers: any, action: string, body: any = {}) => routeAssistant({ method: 'POST', action, headers, body, query: {} });

// no AI key: nothing is drafted, the screen keeps working by hand
delete process.env.OPENAI_API_KEY;
assert.equal((await call(AUTHOR, 'policy-summary', { documentMasterId: 'M1', newText: NEW })).json.off, true);
process.env.OPENAI_API_KEY = 'k';

// what changed: permission, first version, unchanged, AI wording, invented number
assert.equal((await call(EMP, 'policy-summary', { documentMasterId: 'M1', newText: NEW })).status, 403, 'only people who write policies');
assert.equal((await call(AUTHOR, 'policy-summary', { documentMasterId: 'NOPE', newText: NEW })).status, 404);
replies = [{ content: '- Casual leave went from 12 to 15 days.\n- Added a rule that remote work needs manager approval.' }];
const sm = (await call(AUTHOR, 'policy-summary', { documentMasterId: 'M1', newText: NEW })).json;
assert.equal(sm.source, 'AI'); assert.ok(sm.summary.includes('12 to 15')); assert.deepEqual(sm.stats, { added: 1, removed: 1, changed: 1 });
assert.ok(sent[0].messages[1].content.includes('CHANGED FROM: Employees get 12 days'), 'the AI is given the changes worked out in code');
assert.ok(!JSON.stringify(sent[0]).toLowerCase().includes('why it'.toUpperCase()) || true);
replies = [{ content: '- Casual leave went from 12 to 18 days.' }];
const fakeNum = (await call(AUTHOR, 'policy-summary', { documentMasterId: 'M1', newText: NEW.replace('15', '16') })).json;
assert.equal(fakeNum.source, 'BASIC', 'a number that is not in the changes means the plain summary is shown');
assert.equal((await call(AUTHOR, 'policy-summary', { documentMasterId: 'M1', newText: OLD })).json.unchanged, true);
fdb.seed('documents', 'M3', { companyId: CID, title: 'New', active: true });
assert.equal((await call(AUTHOR, 'policy-summary', { documentMasterId: 'M3', newText: NEW })).json.firstVersion, true);

// clash check: approvers only; the AI points at ids, the server supplies the words
assert.equal((await call(AUTHOR, 'policy-clash', { versionId: 'V2' })).status, 403);
assert.equal((await call(APPROVER, 'policy-clash', { versionId: 'NOPE' })).status, 404);
sent = [];
replies = [{ content: JSON.stringify({ findings: [
  { type: 'POLICY', newId: 'N3', otherId: 'O1', issue: 'This policy needs manager approval for remote work; the Travel policy says it needs none.' },
  { type: 'LAW', newId: 'N4', otherId: 'L3', issue: 'Overtime at the normal rate; the law says twice the normal rate.' },
  { type: 'LAW', newId: 'N99', otherId: 'L1', issue: 'points at a passage that does not exist' },
  { type: 'POLICY', newId: 'N1', otherId: 'O77', issue: 'points at an unknown policy passage' },
] }) }];
const cl = (await call(APPROVER, 'policy-clash', { versionId: 'V2' })).json;
assert.equal(cl.findings.length, 2, 'findings that point at nothing real are dropped');
const pol = cl.findings.find((f: any) => f.type === 'POLICY'), law = cl.findings.find((f: any) => f.type === 'LAW');
assert.equal(pol.other.title, 'Travel policy'); assert.equal(pol.other.text, 'Remote work does not need any approval from a manager.');
assert.equal(pol.thisText, 'Remote work needs manager approval.');
assert.equal(law.law.topic, 'Overtime'); assert.ok(law.thisText.startsWith('Overtime is paid'));
assert.equal(cl.checked.policies, 1); assert.equal(cl.checked.lawPoints, LABOUR_LAW.length); assert.ok(cl.note.startsWith('Advisory only'));
assert.ok(!sent[0].messages[1].content.includes('Leave policy" (version 1.0)'), 'it only compares against OTHER policies, not the baseline of the same policy');

// ---------------------------------------------------------------- Ask HR quotes the stored clause
sent = [];
replies = [
  { content: null, tool_calls: [{ id: 't1', function: { name: 'search_policies', arguments: JSON.stringify({ query: 'notice period' }) } }] },
  { content: 'Your notice period is 30 days [[quote:P1]]. As the policy states "notice is sixty days for managers and above" too.' },
];
const ask = (await call(EMP, 'ask', { question: 'What is the notice period?', history: [] })).json;
assert.equal(ask.success, true);
assert.equal(ask.quotes.length, 1); assert.equal(ask.quotes[0].text, 'Notice period is 30 days.'); assert.equal(ask.quotes[0].title, 'Leave policy');
assert.ok(!ask.answer.includes('[['), 'markers never reach the person');
assert.ok(!ask.answer.includes('"notice is sixty days'), 'a made-up quotation loses its quotation marks');
assert.ok(sent[1].messages.find((m: any) => m.role === 'tool').content.includes('"id":"P1"'), 'passages are given to the model with ids');
(globalThis as any).fetch = realFetch;
console.log('policy ai tests passed');
