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
const ADM = tokenFor('u_adm', ['payroll.manage'], true);
const H2 = tokenFor('u_h2', ['payroll.view']);
const FIN = tokenFor('u_fin', ['payroll.view']);
const SIG = tokenFor('u_sig', ['payroll.view']);
const REL = tokenFor('u_rel', ['payroll.manage']);
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
  ['u_low', 'Lal Low'], ['u_mgr', 'Mira Manager'], ['u_stranger', 'Sam Stranger'], ['u_adm', 'Ada Admin'], ['u_h2', 'Hal HR'], ['u_fin', 'Fin Fay'], ['u_sig', 'Sig Sam'], ['u_rel', 'Rel Ray']]) {
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
const runMonth = async (month: string) => {
  const c = await ok(PM, 'POST', 'calculate', { month });
  await ok(PM, 'POST', 'approve', { month, expectedNet: c.run.totals.net });
  await ok(PM, 'POST', 'lock', { month });
  return c;
};


// ================================================================ controls
await ok(PM, 'POST', 'calculate', { month: M1 });
let st = await ok(PM, 'GET', 'approval-state', {}, { month: M1 });
assert.equal(st.enabled, false, 'chain off by default');

// only an admin can change controls
assert.equal((await call(PM, 'POST', 'save-controls', { controls: { chain: { enabled: true } } })).status, 403);
assert.equal((await call(ADM, 'POST', 'save-controls', { controls: { chain: { enabled: true, hr: ['u_h2'], finance: [], signatory: [] } } })).status, 400, 'all steps need people');
await ok(ADM, 'POST', 'save-controls', { controls: {
  chain: { enabled: true, hr: ['u_h2'], finance: ['u_fin'], signatory: ['u_sig'] }, sod: { enabled: true },
  calendar: { enabled: true, cutoffDay: 3, payDay: 7, requireFreeze: true },
  entity: { pfRegNo: 'MH/123', bankName: 'HDFC', bankAccount: '50100123456', bankIfsc: 'hdfc0001234' },
} });
assert.equal((await ok(PV, 'GET', 'controls')).controls.entity.bankIfsc, 'HDFC0001234');

// the single-step approve is closed once the chain is on
assert.equal((await call(PM, 'POST', 'approve', { month: M1 })).status, 409);

// freeze is needed before HR can verify
st = await ok(H2, 'GET', 'approval-state', {}, { month: M1 });
assert.equal(st.next, 'HR');
const hash0 = st.hash;
assert.equal((await call(H2, 'POST', 'approval-step', { month: M1, step: 'HR', expectedHash: hash0 })).status, 409, 'freeze first');
assert.equal((await call(PM, 'POST', 'period-unfreeze', { month: M1, reason: 'x' })).json.already, true);
await ok(PM, 'POST', 'period-freeze', { month: M1 });
assert.equal((await ok(PV, 'GET', 'calendar', {}, { month: M1 })).status, 'FROZEN');

// inputs are refused while frozen
assert.equal((await call(PM, 'POST', 'save-adjustment', { month: M1, uid: 'u_emp', kind: 'EARNING', label: 'Bonus', amount: 500 })).status, 409, 'frozen inputs');

// wrong person / wrong order / stale hash
assert.equal((await call(FIN, 'POST', 'approval-step', { month: M1, step: 'FINANCE', expectedHash: hash0 })).status, 403, 'order');
assert.equal((await call(PM, 'POST', 'approval-step', { month: M1, step: 'HR', expectedHash: hash0 })).status, 403, 'not an approver');
assert.equal((await call(H2, 'POST', 'approval-step', { month: M1, step: 'HR', expectedHash: 'bad' })).status, 409, 'stale hash');
const s1 = await ok(H2, 'POST', 'approval-step', { month: M1, step: 'HR', expectedHash: hash0, force: true });
assert.equal(s1.next, 'FINANCE');
assert.equal((await call(H2, 'POST', 'approval-step', { month: M1, step: 'FINANCE', expectedHash: hash0 })).status, 403, 'same person cannot do two steps');

// unfreezing wipes the approvals and needs a reason
assert.equal((await call(PM, 'POST', 'period-unfreeze', { month: M1 })).status, 400);
await ok(PM, 'POST', 'period-unfreeze', { month: M1, reason: 'Late bonus' });
st = await ok(H2, 'GET', 'approval-state', {}, { month: M1 });
assert.equal(st.next, 'HR', 'approvals cleared');
await ok(PM, 'POST', 'save-adjustment', { month: M1, uid: 'u_emp', kind: 'EARNING', label: 'Bonus', amount: 500 });
await ok(PM, 'POST', 'calculate', { month: M1 });
st = await ok(H2, 'GET', 'approval-state', {}, { month: M1 });
assert.notEqual(st.hash, hash0, 'figures changed, so the fingerprint changed');
await ok(PM, 'POST', 'period-freeze', { month: M1 });
const h = st.hash;
await ok(H2, 'POST', 'approval-step', { month: M1, step: 'HR', expectedHash: h, force: true });
await ok(FIN, 'POST', 'approval-step', { month: M1, step: 'FINANCE', expectedHash: h });
const last = await ok(SIG, 'POST', 'approval-step', { month: M1, step: 'SIGNATORY', expectedHash: h });
assert.equal(last.complete, true);
assert.equal(last.run.status, 'APPROVED');
await ok(PM, 'POST', 'lock', { month: M1 });

// ---------------------------------------------------------------- payments
assert.equal((await call(PM, 'POST', 'payment-submit', { month: M1 })).status, 409, 'prepare first');
const made = await ok(PM, 'POST', 'payment-create', { month: M1 });
assert.ok(made.payment.instructions.length >= 3);
const blocked = made.payment.instructions.filter((i: any) => i.status === 'BLOCKED');
assert.ok(blocked.length >= 1, 'people without bank details are blocked');
assert.equal(made.payment.debit.ifsc, 'HDFC0001234');
assert.equal((await ok(PM, 'POST', 'payment-create', { month: M1 })).existed, true);

// the maker of the run cannot release the money; a different person can
assert.equal((await call(PM, 'POST', 'payment-submit', { month: M1 })).status, 403, 'maker cannot release');
// nothing ready yet because everyone is blocked
assert.equal((await call(REL, 'POST', 'payment-submit', { month: M1 })).status, 409);
assert.equal((await call(REL, 'POST', 'mark-paid', { month: M1 })).status, 409, 'bank batch is open');

// fix a person's bank details, retry, submit
await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: (await ok(PM, 'GET', 'structure', {}, { uid: 'u_emp' })).structure.amounts, annualCtc: 600000, state: 'Maharashtra', pan: 'ABCDE1234F', bankName: 'ICICI', bankAccount: '123456789012', ifsc: 'ICIC0000001' });
const retry = await ok(REL, 'POST', 'payment-retry', { month: M1 });
assert.equal(retry.retried, 1);
const sub = await ok(REL, 'POST', 'payment-submit', { month: M1, ref: 'BATCH-1' });
assert.equal(sub.payment.summary.by.SUBMITTED.count, 1);
const exp = await ok(PV, 'GET', 'payment-export', {}, { month: M1 });
assert.equal(exp.rows.length, 1);

// the bank answers: one fails, so it cannot be closed
const emp1 = made.payment.instructions.find((i: any) => i.uid === 'u_emp');
const resp = await ok(REL, 'POST', 'payment-import', { month: M1, csv: `Employee ID,Status,Reference,Reason\n${emp1.empId},FAILED,,Account closed\nZZZ,PAID,U1,\n` });
assert.equal(resp.updated, 1);
assert.deepEqual(resp.unknownEmployees, ['ZZZ']);
assert.equal((await call(REL, 'POST', 'payment-close', { month: M1 })).status, 409, 'not everything is paid');
assert.equal((await call(REL, 'POST', 'payment-mark', { month: M1, uid: 'u_emp', status: 'PAID' })).status, 400, 'a reference is needed');
await ok(REL, 'POST', 'payment-mark', { month: M1, uid: 'u_emp', status: 'PAID', ref: 'UTR1' });
for (const i of made.payment.instructions.filter((x: any) => x.uid !== 'u_emp')) {
  await ok(REL, 'POST', 'payment-mark', { month: M1, uid: i.uid, status: 'PAID', ref: 'MANUAL' });
}
const closed = await ok(REL, 'POST', 'payment-close', { month: M1, paidOn: `${M1}-28` });
assert.equal(closed.run.status, 'PAID');
assert.equal(closed.payment.status, 'CLOSED');

// ---------------------------------------------------------------- salary versions
const vers = await ok(PV, 'GET', 'salary-versions', {}, { uid: 'u_emp' });
assert.equal(vers.versions.length, 1, 'a bank-detail edit is not a salary change');
const cur = (await ok(PM, 'GET', 'structure', {}, { uid: 'u_emp' })).structure;
const bumped = { ...cur.amounts, [Object.keys(cur.amounts)[0]]: cur.amounts[Object.keys(cur.amounts)[0]] + 1000 };
await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: bumped, annualCtc: 700000, state: 'Maharashtra', effectiveFrom: `${CUR}-01` });
const vers2 = await ok(PV, 'GET', 'salary-versions', {}, { uid: 'u_emp', asOf: `${M1}-15` });
assert.equal(vers2.versions.length, 2);
assert.equal(vers2.asOf.version.annualCtc, 600000, 'as of last month, the old salary applies');
assert.ok(vers.versions.every((v: any) => v.gross > 0));

// ---------------------------------------------------------------- cost centres
assert.equal((await call(PM, 'POST', 'save-cost-centres', { items: [{ name: 'Sales' }, { name: 'sales' }] })).status, 400, 'duplicate');
await ok(PM, 'POST', 'save-cost-centres', { items: [{ name: 'Sales' }, { name: 'Support' }] });
assert.equal((await call(PM, 'POST', 'save-cost-allocation', { uid: 'u_emp', rows: [{ costCentreId: 'sales', pct: 60 }, { costCentreId: 'support', pct: 30 }] })).status, 400, 'must add to 100');
await ok(PM, 'POST', 'save-cost-allocation', { uid: 'u_emp', rows: [{ costCentreId: 'sales', pct: 60 }, { costCentreId: 'support', pct: 40 }] });
assert.equal((await call(PM, 'POST', 'save-cost-centres', { items: [{ name: 'Support' }] })).status, 409, 'cannot drop a used centre');
const rep = await ok(PV, 'GET', 'cost-report', {}, { month: M1 });
const sales = rep.rows.find((r: any) => r.id === 'sales');
const support = rep.rows.find((r: any) => r.id === 'support');
const lines = (await ok(PV, 'GET', 'run', {}, { month: M1 })).lines;
const emp = lineOf(lines, 'u_emp');
assert.ok(sales && support);
assert.equal(r2(sales.gross + support.gross), emp.line.gross, 'split adds back to the whole, to the paisa');
assert.ok(rep.rows.find((r: any) => r.id === '__none'), 'people without an allocation are shown, not hidden');

console.log('payroll controls api tests passed');
