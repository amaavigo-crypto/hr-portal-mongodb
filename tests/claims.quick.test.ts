import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { r2 } from '../shared/payrollEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({
  db: fdb,
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});

const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const PM = tokenFor('u_pm', ['payroll.manage']);
const PV = tokenFor('u_pv', ['payroll.view']);
const EMP = tokenFor('u_emp');
const OTHER = tokenFor('u_other');
const LOW = tokenFor('u_low');
const MGR = tokenFor('u_mgr');
const STRANGER = tokenFor('u_stranger');

const CUR = istToday().slice(0, 7);
const M2 = addDays(`${CUR}-01`, -1).slice(0, 7);
const M1 = addDays(`${M2}-01`, -1).slice(0, 7);

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_pm', 'Pia Payroll'], ['u_pv', 'Vik Viewer'], ['u_emp', 'Esha Employee'], ['u_other', 'Omar Other'],
  ['u_low', 'Lal Low'], ['u_mgr', 'Mira Manager'], ['u_stranger', 'Sam Stranger']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase() });
}

const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routePayroll({ method, action, headers, body, query });
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(headers, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const lcall = (headers: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers, body, query: {}, ip: '1.2.3.4' });
const lineOf = (lines: any[], uid: string) => lines.find((l) => l.uid === uid);

// ---------------------------------------------------------------- setup
await lcall(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
await lcall(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', joinDate: '2020-01-01', gender: 'F', managerUid: 'u_mgr' }, { uid: 'u_other', joinDate: '2020-01-01', managerUid: 'u_mgr' },
  { uid: 'u_low', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2019-01-01' },
] });
await ok(PM, 'POST', 'apply-starter');
const split = await ok(PM, 'POST', 'split-ctc', { annualCtc: 600000 });
await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: split.amounts, annualCtc: 600000, state: 'Maharashtra', pan: 'ABCDE1234F' });
await ok(PM, 'POST', 'import-structures', { rows: [
  { email: 'u_other@acme.com', BASIC: '30000', HRA: '12000', SPL: '8000', state: 'Maharashtra', TDS: '1000' },
  { email: 'u_low@acme.com', BASIC: '9000', HRA: '3000', SPL: '3000', state: 'Maharashtra' },
] });

// ================================================================ quick claims: drafts, scan, flags
const D = istToday();
const jpg = (n: string) => ({ name: `${n}.jpg`, type: 'image/jpeg', data: Buffer.from(`pic-${n}`).toString('base64') });
const realFetch = globalThis.fetch;
let aiReply: any = null;
(globalThis as any).fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiReply) } }], usage: { prompt_tokens: 800, completion_tokens: 60 } }) });

// draft with a bill and two proof photos; nothing reaches the approver
const d1 = (await ok(EMP, 'POST', 'claim-draft-save', { files: [{ ...jpg('bill1'), kind: 'BILL' }, { ...jpg('p1'), kind: 'PROOF' }, { ...jpg('p2'), kind: 'PROOF' }], purpose: 'x' })).draft;
assert.equal(d1.status, 'DRAFT'); assert.equal(d1.files.length, 3); assert.equal(d1.hasBill, true);
assert.equal(d1.billHash, undefined, 'hash is never sent to the browser');
assert.equal(fdb.all('payrollClaimFiles').length, 3);
let mine = await ok(EMP, 'GET', 'my-claims');
assert.equal(mine.drafts.length, 1); assert.equal(mine.items.length, 0, 'drafts are not counted as claims');
assert.equal((await ok(PM, 'GET', 'claims')).items.length, 0, 'approvers do not see drafts');
assert.equal((await call(OTHER, 'POST', 'claim-draft-scan', { id: d1.id })).status, 404, 'only the owner can use a draft');

// limits
assert.equal((await call(EMP, 'POST', 'claim-draft-save', { id: d1.id, files: ['a', 'b', 'c', 'd'].map((n) => ({ ...jpg(n), kind: 'PROOF' })) })).status, 400, 'at most 6 photos');
assert.equal((await call(EMP, 'POST', 'claim-draft-save', { id: d1.id, files: [{ name: 'x.pdf', type: 'application/pdf', data: 'AAAA', kind: 'PROOF' }] })).status, 400, 'proof must be a photo');
assert.equal((await call(EMP, 'POST', 'claim-draft-save', { id: d1.id, files: [{ name: 'x.exe', type: 'application/x-msdownload', data: 'AAAA', kind: 'BILL' }] })).status, 400);

// scan: AI reads the bill; low confidence is blanked; category comes from the company list
process.env.OPENAI_API_KEY = 'k';
aiReply = { isBill: true, amount: 1000, date: D, vendor: 'Grand Hotel', gstin: '27AAPFU0939F1ZV', category: 'Travel', confidence: { amount: 'high', date: 'high', vendor: 'high', gstin: 'high' } };
const sc = await ok(EMP, 'POST', 'claim-draft-scan', { id: d1.id });
assert.equal(sc.scanned, true); assert.equal(sc.scan.amount, 1000); assert.equal(sc.scan.gstinValid, true); assert.equal(sc.category, 'Travel');
assert.ok(fdb.all('aiUsageLog').some((l: any) => l.feature === 'claims.scan'), 'scan is in the AI usage log');
aiReply = { isBill: false };
assert.equal((await ok(EMP, 'POST', 'claim-draft-scan', { id: d1.id })).notABill, true);
aiReply = { isBill: true, amount: 1000, date: D, vendor: 'Grand Hotel', gstin: '27AAPFU0939F1ZV', category: 'Travel', confidence: {} };
await ok(EMP, 'POST', 'claim-draft-scan', { id: d1.id });

// submit from the draft with a different amount: the approver is warned, the claim still goes through
const sub = await ok(EMP, 'POST', 'submit-claim', { draftId: d1.id, category: 'Travel', amount: 1200, expenseDate: D, description: 'Client meeting at the hotel' });
assert.equal(sub.id, d1.id);
mine = await ok(EMP, 'GET', 'my-claims');
assert.equal(mine.drafts.length, 0); assert.equal(mine.items.length, 1);
assert.equal(mine.items[0].flags, undefined, 'the claimant does not see approver flags');
const listed = (await ok(PM, 'GET', 'claims')).items.find((c: any) => c.id === sub.id);
assert.deepEqual(listed.flags.map((f: any) => f.kind), ['AMOUNT_MISMATCH']);
assert.equal(listed.scan.vendor, 'Grand Hotel'); assert.equal(listed.files.length, 3);
assert.equal(listed.billHash, undefined);

// the same bill photo again, by someone else, is flagged as a duplicate
const d2 = (await ok(OTHER, 'POST', 'claim-draft-save', { files: [{ ...jpg('bill1'), kind: 'BILL' }] })).draft;
const sub2 = await ok(OTHER, 'POST', 'submit-claim', { draftId: d2.id, category: 'Travel', amount: 1000, expenseDate: D, description: 'Hotel' });
const l2 = (await ok(PM, 'GET', 'claims')).items.find((c: any) => c.id === sub2.id);
assert.ok(l2.flags.some((f: any) => f.kind === 'DUPLICATE_FILE' && f.text.includes('another employee')));

// photos: owner and approver can open them, a stranger cannot
const proof = listed.files.find((f: any) => f.kind === 'PROOF');
assert.equal((await ok(EMP, 'GET', 'claim-file', undefined, { id: sub.id, fileId: proof.id })).type, 'image/jpeg');
assert.equal((await ok(PM, 'GET', 'claim-file', undefined, { id: sub.id, fileId: proof.id })).name, 'p1.jpg');
assert.equal((await call(STRANGER, 'GET', 'claim-file', undefined, { id: sub.id, fileId: proof.id })).status, 403);
assert.equal((await ok(PM, 'GET', 'claim-bill', undefined, { id: sub.id })).name, 'bill1.jpg', 'bill link still gives the bill');

// removing a photo, and withdrawing a draft cleans up the files
const d3 = (await ok(EMP, 'POST', 'claim-draft-save', { files: [{ ...jpg('b3'), kind: 'BILL' }, { ...jpg('p3'), kind: 'PROOF' }] })).draft;
const before = fdb.all('payrollClaimFiles').length;
const rm = await ok(EMP, 'POST', 'claim-draft-remove-file', { id: d3.id, fileId: d3.files[1].id });
assert.equal(rm.draft.files.length, 1); assert.equal(fdb.all('payrollClaimFiles').length, before - 1);
await ok(EMP, 'POST', 'withdraw-claim', { id: d3.id });
assert.equal(fdb.all('payrollClaimFiles').length, before - 2);

// AI off: the form is simply filled in by hand
delete process.env.OPENAI_API_KEY;
const d4 = (await ok(EMP, 'POST', 'claim-draft-save', { files: [{ ...jpg('b4'), kind: 'BILL' }] })).draft;
const off = await ok(EMP, 'POST', 'claim-draft-scan', { id: d4.id });
assert.equal(off.scanned, false); assert.equal(off.off, true);
// a bill is still needed above the limit when submitting without one
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 5000, expenseDate: D, description: 'no bill' })).status, 400);
(globalThis as any).fetch = realFetch;
console.log('quick claims tests passed');
