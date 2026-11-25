/**
 * Document Version Control agent: tools, visibility (drafts never reach employees), acknowledgements, watcher lines.
 * Run: npx tsx tests/documentAgent.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { buildDigests } from '../shared/agentWatcher.ts';
import {
  DOCUMENT_AGENT_TOOLS, diffText, documentToolsFor, documentWatch, findDocument, summarizeAcknowledgements, summarizeHealth, summarizeReviewQueue,
} from '../shared/documentAgentTools.ts';

const TODAY = '2026-11-25';

// ------------------------------------------------------------------ pure parts
const names = (w: any) => documentToolsFor(w).map((t) => t.name);
assert.deepEqual(names({ perms: ['doc.acknowledge'] }), ['get_my_acknowledgements', 'get_policy_changes']);
assert.deepEqual(names({ perms: ['doc.create'] }), ['get_my_acknowledgements', 'get_policy_changes', 'get_review_queue', 'get_document_health']);
assert.equal(names({ perms: ['compliance.view'] }).includes('get_acknowledgement_status'), true);
assert.equal(names({ perms: ['compliance.view'] }).includes('get_review_queue'), false);
assert.equal(names({ perms: [], isCompanyAdmin: true }).length, DOCUMENT_AGENT_TOOLS.length);
assert.ok(DOCUMENT_AGENT_TOOLS.every((t) => t.kind === 'read'), 'read only');
assert.ok(DOCUMENT_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|uid|employeeId/i)), 'no tool takes a company or person id');

assert.equal(findDocument([{ documentId: 'AMA-1', title: 'Leave Policy' }, { documentId: 'AMA-2', title: 'Code of Conduct' }], 'code of conduct')!.documentId, 'AMA-2');
assert.equal(findDocument([{ documentId: 'AMA-1', title: 'Leave Policy' }], 'ama-1')!.title, 'Leave Policy');
assert.equal(findDocument([{ documentId: 'AMA-1', title: 'Leave Policy' }], 'travel'), null);

const d = diffText('Staff get 12 days leave.\nNotice is 3 days.\nCarry forward is allowed.', 'Staff get 15 days leave.\nNotice is 3 days.\nCarry forward is allowed.\nHalf days are allowed.');
assert.deepEqual([d.addedCount, d.removedCount], [2, 1]);
assert.ok(d.added.includes('Half days are allowed.') && d.removed.includes('Staff get 12 days leave.'));
assert.deepEqual([diffText('same text here', 'same text here').addedCount, diffText('same text here', 'Same  text, here').removedCount], [0, 0], 'case and punctuation are not changes');

const V = (o: any) => ({ id: o.id, documentMasterId: 'm1', documentId: 'AMA-1', documentTitle: 'Leave Policy', versionNumber: '1.0', ...o });
const q = summarizeReviewQueue([V({ id: 'a', status: 'IN_REVIEW', createdById: 'u1', createdAt: '2026-11-20T00:00:00Z' }), V({ id: 'b', status: 'IN_REVIEW', createdById: 'u2', createdAt: '2026-11-24T00:00:00Z', documentTitle: 'Travel' }), V({ id: 'c', status: 'DRAFT', createdById: 'u1' }), V({ id: 'd', status: 'REVISION_REQUIRED', createdById: 'u1', createdAt: '2026-11-01T00:00:00Z' })], TODAY, { perms: ['doc.review'] });
assert.deepEqual([q.waitingForReview, q.items[0].createdDaysAgo, q.sentBackForRevision], [2, 5, 1], 'drafts are not in the queue');
const own = summarizeReviewQueue([V({ id: 'a', status: 'IN_REVIEW', createdById: 'u1' }), V({ id: 'b', status: 'IN_REVIEW', createdById: 'u2' })], TODAY, { perms: ['doc.create'], uid: 'u1' });
assert.equal(own.waitingForReview, 1, 'a creator sees only their own');

const pub = [
  { v: V({ id: 'p1', status: 'PUBLISHED', reviewDueDate: '2026-11-01', publishedAt: '2026-11-10T00:00:00Z' }), m: { id: 'm1', active: true, acknowledgementRequired: true } },
  { v: V({ id: 'p2', documentId: 'AMA-2', documentTitle: 'Conduct', status: 'PUBLISHED', reviewDueDate: '2026-12-10', effectiveTo: '2026-11-30', publishedAt: '2026-11-24T00:00:00Z' }), m: { id: 'm2', active: true, acknowledgementRequired: true } },
  { v: V({ id: 'p3', documentId: 'AMA-3', documentTitle: 'Old', status: 'PUBLISHED', reviewDueDate: '2020-01-01' }), m: { id: 'm3', active: false } },
];
const h = summarizeHealth(pub, TODAY);
assert.deepEqual([h.reviewOverdue, h.reviewDueWithin30Days, h.expiringWithin30Days, h.expired], [1, 1, 1, 0], 'inactive documents are ignored');
assert.equal(h.reviewOverdueList[0].days, -24);

const acks = [
  { documentVersionId: 'p1', employeeId: 'e1', employeeName: 'Esha', employeeEmail: 'e1@x', departmentName: 'Ops', status: 'ACKNOWLEDGED' },
  { documentVersionId: 'p1', employeeId: 'e2', employeeName: 'Omar', employeeEmail: 'e2@x', departmentName: 'Ops', status: 'PENDING' },
  { documentVersionId: 'p1', employeeId: 'e3', employeeName: 'Pia', employeeEmail: 'e3@x', departmentName: 'Sales', status: 'PENDING' },
  { documentId: 'AMA-2', versionNumber: '1.0', employeeId: 'e1', status: 'PENDING' },
  { documentVersionId: 'older', employeeId: 'e1', status: 'PENDING' },
];
const all = summarizeAcknowledgements(pub, acks, TODAY) as any;
assert.equal(all.documentsNeedingAcknowledgement, 2);
assert.deepEqual([all.documents[0].document, all.documents[0].percent], ['Conduct', 0], 'lowest first');
assert.equal(all.documents.find((x: any) => x.document === 'Leave Policy').percent, 33, 'an old version\'s record does not count');
const one = summarizeAcknowledgements(pub, acks, TODAY, 'leave policy') as any;
assert.deepEqual([one.pending, one.pendingByDepartment, one.pendingPeople], [2, { Ops: 1, Sales: 1 }, ['Omar', 'Pia']]);
assert.ok((summarizeAcknowledgements(pub, acks, TODAY, 'nope') as any).error);

const dw = documentWatch([V({ id: 'a', status: 'IN_REVIEW', createdAt: '2026-11-20T00:00:00Z' }), V({ id: 'b', status: 'IN_REVIEW', createdAt: '2026-11-24T00:00:00Z' })], pub, acks,
  [{ uid: 'e2', email: 'e2@x' }, { uid: 'u3', email: 'e3@x' }, { uid: 'e1', email: 'e1@x' }], TODAY);
assert.equal(dw.reviewWaiting.length, 1, 'only the one waiting 3+ days');
assert.equal(dw.lowAcknowledged.length, 1);
assert.deepEqual(dw.pendingAcks.map((a) => a.uid).sort(), ['e2', 'u3'], 'matched by id or email; the 1-day-old policy is not nagged yet');

const base = { today: TODAY, people: [{ uid: 'hr', name: 'Hema', email: 'h@x' }, { uid: 'e2', name: 'Omar', email: 'e2@x' }], hrUids: ['hr'], leaves: [], exceptions: [], exits: [], tasks: [], records: [] };
const dg = buildDigests({ ...base, documents: dw });
assert.ok(dg.find((x) => x.uid === 'hr')!.sections.some((s) => /Policy due for review \(1\)|Policies due for review \(2\)/.test(s.heading)));
assert.ok(dg.find((x) => x.uid === 'hr')!.sections.some((s) => /waiting for review \(1\)/.test(s.heading)));
assert.ok(dg.find((x) => x.uid === 'e2')!.sections.some((s) => /to acknowledge \(1\)/.test(s.heading)));
assert.equal(buildDigests({ ...base }).length, 0);

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const REV = tokenFor('u_rev', ['doc.review', 'doc.acknowledge', 'compliance.view']);
const EMP = tokenFor('u_emp', ['doc.acknowledge']);
const OPS = tokenFor('u_ops', ['doc.acknowledge']);
const FOREIGN = tokenFor('u_rev', ['doc.review', 'compliance.view'], 'c2');
fdb.seed('companies', CID, { name: 'Acme Ltd' }); fdb.seed('companies', 'c2', { name: 'Other Ltd' });
for (const [uid, name, dept] of [['u_rev', 'Rita Reviewer', 'HR'], ['u_emp', 'Esha Employee', 'Finance'], ['u_ops', 'Omar Ops', 'Ops']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: dept, departmentId: dept, empId: uid, title: 'Staff' });
}
const seedDoc = (id: string, o: any) => fdb.seed('documents', id, { companyId: CID, active: true, acknowledgementRequired: true, confidentiality: 'Public (All Employees)', documentId: o.code, title: o.title, currentStatus: 'PUBLISHED', ...o.m });
seedDoc('m1', { code: 'AMA-1', title: 'Leave Policy' });
seedDoc('m2', { code: 'AMA-2', title: 'Finance Controls', m: { confidentiality: 'Specific Department', departmentName: 'Finance' } });
seedDoc('m3', { code: 'AMA-3', title: 'Secret Draft Policy', m: { currentStatus: 'IN_REVIEW' } });
const ver = (id: string, o: any) => fdb.seed('versions', id, { companyId: CID, documentTitle: o.t, documentId: o.code, documentMasterId: o.m, versionNumber: o.n, status: o.s, createdById: 'u_rev', createdByName: 'Rita Reviewer', createdAt: '2026-11-10T00:00:00Z', publishedAt: o.pub || '', reviewDueDate: o.due || '', rawContent: o.text || '', previousVersionId: o.prev || '', changeSummary: o.sum || '' });
ver('v1_old', { t: 'Leave Policy', code: 'AMA-1', m: 'm1', n: '1.0', s: 'SUPERSEDED', pub: '2026-01-01T00:00:00Z', text: 'Staff get 12 days leave.\nNotice is 3 days.' });
ver('v1', { t: 'Leave Policy', code: 'AMA-1', m: 'm1', n: '2.0', s: 'PUBLISHED', pub: '2026-11-10T00:00:00Z', due: '2026-11-01', prev: 'v1_old', sum: 'Leave raised to 15 days.', text: 'Staff get 15 days leave.\nNotice is 3 days.' });
ver('v2', { t: 'Finance Controls', code: 'AMA-2', m: 'm2', n: '1.0', s: 'PUBLISHED', pub: '2026-11-10T00:00:00Z', text: 'Two approvals above 50000.' });
ver('v3', { t: 'Secret Draft Policy', code: 'AMA-3', m: 'm3', n: '1.0', s: 'IN_REVIEW', text: 'TOP SECRET DRAFT WORDING' });
const ack = (id: string, uid: string, name: string, dept: string, ver: string, doc: string, status: string) => fdb.seed('acknowledgments', id, { companyId: CID, documentId: doc, documentVersionId: ver, versionNumber: ver === 'v1' ? '2.0' : '1.0', employeeId: uid, employeeName: name, employeeEmail: `${uid}@acme.com`, departmentName: dept, status });
ack('a1', 'u_emp', 'Esha Employee', 'Finance', 'v1', 'AMA-1', 'PENDING');
ack('a2', 'u_ops', 'Omar Ops', 'Ops', 'v1', 'AMA-1', 'ACKNOWLEDGED');
ack('a3', 'u_rev', 'Rita Reviewer', 'HR', 'v1', 'AMA-1', 'PENDING');

process.env.OPENAI_API_KEY = 'test-key';
let seenTools: string[] = []; let toolReplies: any[] = [];
const script = (calls: { name: string; args?: any }[]) => {
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const last = body.messages[body.messages.length - 1];
    const message = last.role !== 'tool'
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
      : { role: 'assistant', content: 'Done.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const run = async (h: any, calls: { name: string; args?: any }[]) => { script(calls); return routeAssistant({ method: 'POST', action: 'ask', headers: h, query: {}, body: { question: 'documents?' } }); };

// an employee: own acknowledgements, policy changes; no manager tools
await run(EMP, [{ name: 'get_my_acknowledgements' }, { name: 'get_policy_changes', args: { document: 'leave policy' } }, { name: 'get_policy_changes', args: { document: 'Secret Draft Policy' } }, { name: 'get_review_queue' }]);
assert.ok(seenTools.includes('get_policy_changes') && !seenTools.includes('get_review_queue') && !seenTools.includes('get_acknowledgement_status'), `EMP was shown: ${seenTools}`);
assert.equal(toolReplies[0].pendingCount, 1);
assert.equal(toolReplies[1].currentVersion, '2.0');
assert.equal(toolReplies[1].previousVersion, '1.0');
assert.equal(toolReplies[1].authorSummary, 'Leave raised to 15 days.');
assert.deepEqual([toolReplies[1].changes.addedCount, toolReplies[1].changes.removedCount], [1, 1]);
assert.ok(toolReplies[2].error, 'a document in review cannot be found by an employee');
assert.match(toolReplies[3].error, /Not available/);
assert.ok(!JSON.stringify(toolReplies).includes('TOP SECRET'), 'draft wording never reaches an employee');
await run(EMP, [{ name: 'get_acknowledgement_status' }]);
assert.match(toolReplies[0].error, /Not available/);


// department-limited documents: only that department's people can find them
await run(EMP, [{ name: 'get_policy_changes', args: { document: 'Finance Controls' } }]);
assert.equal(toolReplies[0].currentVersion, '1.0', 'Finance can read it');
await run(OPS, [{ name: 'get_policy_changes', args: { document: 'Finance Controls' } }]);
assert.ok(toolReplies[0].error, 'Ops cannot');

// a reviewer: queue, health, acknowledgement status with names
await run(REV, [{ name: 'get_review_queue' }, { name: 'get_document_health' }, { name: 'get_acknowledgement_status' }, { name: 'get_acknowledgement_status', args: { document: 'Leave Policy' } }]);
assert.equal(toolReplies[0].waitingForReview, 1);
assert.equal(toolReplies[0].items[0].document, 'Secret Draft Policy');
assert.ok(!JSON.stringify(toolReplies[0]).includes('TOP SECRET'), 'the queue lists titles, never the text');
assert.equal(toolReplies[1].reviewOverdue, 1);
assert.equal(toolReplies[2].documentsNeedingAcknowledgement, 2, 'the draft is not published, so it is not counted');
assert.deepEqual(toolReplies[3].pendingPeople.sort(), ['Esha Employee', 'Rita Reviewer']);
assert.equal(toolReplies[3].percent, 33);
assert.ok(!seenTools.some((n) => /approve|publish|reject|remind|acknowledge_for/.test(n)), 'no write tool exists');

// another company sees nothing
await run(FOREIGN, [{ name: 'get_document_health' }, { name: 'get_acknowledgement_status' }]);
assert.equal(toolReplies[0].publishedDocuments, 0);
assert.equal(toolReplies[1].documentsNeedingAcknowledgement, 0);

console.log('document agent tests passed');
