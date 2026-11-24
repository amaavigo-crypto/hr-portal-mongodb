import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { lineId, runId } from '../api/_lib/payrollKit.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const PM = tok('pm', ['payroll.manage']), PV = tok('pv', ['payroll.view']), EMP = tok('emp'), OTHER = tok('pm2', ['payroll.manage'], 'c2');
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePayroll({ method, action, headers: h, body, query });

const M = '2026-10';
fdb.seed('payrollRuns', runId('c1', M), { companyId: 'c1', month: M, status: 'APPROVED' });
fdb.seed('payrollRuns', runId('c1', '2026-11'), { companyId: 'c1', month: '2026-11', status: 'DRAFT' });
fdb.seed('payrollRunLines', lineId('c1', M, 'u1'), {
  companyId: 'c1', month: M, uid: 'u1',
  employee: { name: 'Asha', empId: 'E1', uan: '100200300400', esicNo: '1234567890', pan: 'ABCDE1234F', state: 'Maharashtra' },
  line: { gross: 30000, paidDays: 30, payDays: 30, tds: 1000, statutory: { pfWage: 20000, pfEmployee: 1800, pfEmployer: 1800, edli: 100, pfAdmin: 100, esicWage: 18000, esicEmployee: 135, esicEmployer: 585, pt: 200 } },
});

assert.equal((await call(EMP, 'GET', 'statutory-dues', {}, { month: M })).status, 403);
assert.equal((await call(PV, 'POST', 'save-challan', { authority: 'PF', month: M, amount: 1 })).status, 403, 'viewers cannot record challans');
assert.equal((await call(PM, 'GET', 'statutory-dues', {}, { month: '2026-11' })).status, 409, 'draft run cannot be filed');

let r = await call(PM, 'GET', 'statutory-dues', {}, { month: M });
assert.equal(r.status, 200);
const pf = r.json.rows.find((x: any) => x.authority === 'PF');
assert.equal(pf.amount, 3800); assert.equal(pf.open, 3800); assert.equal(pf.dueDate, '2026-11-15'); assert.equal(pf.overdue, true);

r = await call(PM, 'POST', 'save-challan', { authority: 'PF', month: M, amount: 3000, paidOn: '2026-11-10', challanNo: 'C1' });
assert.equal(r.status, 200, JSON.stringify(r.json));
const id = r.json.id;
assert.equal((await call(PM, 'POST', 'save-challan', { authority: 'XX', month: M, amount: 5 })).status, 400);
assert.equal((await call(PM, 'POST', 'save-challan', { authority: 'PF', month: M, amount: 0 })).status, 400);
assert.equal((await call(PM, 'POST', 'save-challan', { authority: 'PF', month: M, amount: 5, paidOn: 'nope' })).status, 400);
r = await call(PM, 'GET', 'statutory-dues', {}, { month: M });
const pf2 = r.json.rows.find((x: any) => x.authority === 'PF');
assert.equal(pf2.deposited, 3000); assert.equal(pf2.open, 800);

assert.equal((await call(OTHER, 'POST', 'save-challan', { id, authority: 'PF', month: M, amount: 9 })).status, 404, 'another company cannot edit it');
assert.equal((await call(OTHER, 'POST', 'delete-challan', { id })).status, 404);
assert.equal((await call(PV, 'GET', 'challans')).json.items.length, 1);

r = await call(PM, 'GET', 'statutory-file', {}, { month: M, kind: 'ecr' });
assert.equal(r.json.rows, 1); assert.equal(r.json.filename, 'ECR_202610.txt');
r = await call(PM, 'GET', 'statutory-file', {}, { month: M, kind: 'esi' });
assert.equal(r.json.rows, 1);
assert.equal((await call(PM, 'GET', 'statutory-file', {}, { month: M, kind: 'zzz' })).status, 400);

r = await call(PM, 'GET', 'statutory-tds', {}, { fy: '2026-27', quarter: '3' });
assert.equal(r.status, 200); assert.equal(r.json.totals.deducted, 1000);
assert.equal((await call(PM, 'GET', 'statutory-tds', {}, { fy: 'x', quarter: '3' })).status, 400);
assert.equal((await call(PM, 'GET', 'statutory-tds', {}, { fy: '2026-27', quarter: '9' })).status, 400);

assert.equal((await call(PM, 'POST', 'delete-challan', { id })).status, 200);
assert.equal((await call(PV, 'GET', 'challans')).json.items.length, 0);
console.log('payroll.statutory.api ok');
