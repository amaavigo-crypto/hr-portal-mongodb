import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { lineId, runId } from '../api/_lib/payrollKit.ts';
import { buildJournal, lastDayOf, quickbooksCsv, tallyXml } from '../shared/accountingExport.ts';

const st = (o: any = {}) => ({ pfWage: 0, pfEmployee: 0, pfEmployer: 0, edli: 0, pfAdmin: 0, esicWage: 0, esicEmployee: 0, esicEmployer: 0, pt: 0, ...o });
// gross 30000, deductions: PF 1800 + PT 200 + TDS 1000 + loan 500 = 3500, net 26500; employer PF 1800 + edli 100 + admin 100
const a: any = { gross: 30000, totalDeductions: 3500, net: 26500, tds: 1000, reimbursementTotal: 0, statutory: st({ pfEmployee: 1800, pfEmployer: 1800, edli: 100, pfAdmin: 100, pt: 200 }) };
// gross 20000 + reimbursement 1000, ESI 150 / 650, LWF 25 / 75, deductions 150+25 = 175, net 20825
const b: any = { gross: 20000, totalDeductions: 175, net: 20825, tds: 0, reimbursementTotal: 1000, statutory: st({ esicEmployee: 150, esicEmployer: 650, lwfEmployee: 25, lwfEmployer: 75 }) };

assert.equal(lastDayOf('2026-02'), '2026-02-28'); assert.equal(lastDayOf('2028-02'), '2028-02-29'); assert.equal(lastDayOf('2026-12'), '2026-12-31');
const j = buildJournal('2026-10', [a, b]);
assert.equal(j.balanced, true, JSON.stringify(j.problems));
const by = (k: string) => j.entries.find((e) => e.key === k)!;
assert.equal(by('salaryExpense').debit, 51000, 'gross plus reimbursements');
assert.equal(by('employerPfExpense').debit, 2000); assert.equal(by('employerEsiExpense').debit, 650); assert.equal(by('employerLwfExpense').debit, 75);
assert.equal(by('salaryPayable').credit, 47325);
assert.equal(by('pfPayable').credit, 3800, 'employee and employer share'); assert.equal(by('esiPayable').credit, 800);
assert.equal(by('ptPayable').credit, 200); assert.equal(by('tdsPayable').credit, 1000); assert.equal(by('lwfPayable').credit, 100);
assert.equal(by('otherDeductions').credit, 500, 'the loan recovery');
assert.equal(j.debit, j.credit);
assert.equal(buildJournal('2026-10', [{ ...a, net: 26000 }]).balanced, false, 'an unbalanced run is flagged');
assert.equal(buildJournal('2026-10', []).problems.length, 1);
assert.equal(buildJournal('2026-10', [a], { salaryExpense: 'Wages & Salaries' }).entries[0].ledger, 'Wages & Salaries', 'custom ledger names apply');

const x = tallyXml(j, { company: 'Acme <Pvt> & Co' });
assert.match(x, /<SVCURRENTCOMPANY>Acme &lt;Pvt&gt; &amp; Co<\/SVCURRENTCOMPANY>/);
assert.match(x, /<DATE>20261031<\/DATE>/); assert.match(x, /<VOUCHERNUMBER>PAY-2026-10<\/VOUCHERNUMBER>/);
const amounts = [...x.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
assert.equal(Math.round(amounts.reduce((n, v) => n + v, 0) * 100), 0, 'Tally amounts sum to zero (debits negative)');
assert.equal((x.match(/<ISDEEMEDPOSITIVE>Yes/g) || []).length, 4);
const csv = quickbooksCsv(j);
assert.match(csv, /"PAY-2026-10",31\/10\/2026,"Salaries and Wages",51000.00,,/);
assert.match(quickbooksCsv(j, { dateFormat: 'MM/DD/YYYY' }), /10\/31\/2026/); assert.match(quickbooksCsv(j, { dateFormat: 'YYYY-MM-DD' }), /2026-10-31/);
assert.equal(csv.trim().split('\n').length, 1 + j.entries.length);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid: 'c1', cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const PM = tok('pm', ['payroll.manage']), PV = tok('pv', ['payroll.view']), EMP = tok('emp');
fdb.seed('companies', 'c1', { name: 'A' });
fdb.seed('payrollSettings', 'c1', { company: { legalName: 'Acme Pvt Ltd' } });
fdb.seed('payrollRuns', runId('c1', '2026-10'), { companyId: 'c1', month: '2026-10', status: 'LOCKED' });
fdb.seed('payrollRuns', runId('c1', '2026-11'), { companyId: 'c1', month: '2026-11', status: 'DRAFT' });
fdb.seed('payrollRunLines', lineId('c1', '2026-10', 'u1'), { companyId: 'c1', month: '2026-10', uid: 'u1', employee: { name: 'Asha', empId: 'E1' }, line: a });
fdb.seed('payrollRunLines', lineId('c1', '2026-10', 'u2'), { companyId: 'c1', month: '2026-10', uid: 'u2', employee: { name: 'Bela', empId: 'E2' }, line: b });
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePayroll({ method, action, headers: h, body, query });

assert.equal((await call(EMP, 'GET', 'accounting-export', {}, { month: '2026-10', format: 'tally' })).status, 403);
assert.equal((await call(PM, 'GET', 'accounting-export', {}, { month: '2026-11', format: 'tally' })).status, 409, 'draft run');
assert.equal((await call(PM, 'GET', 'accounting-export', {}, { month: '2026-10', format: 'zip' })).status, 400);
assert.equal((await call(PV, 'POST', 'save-accounting-mapping', { ledgers: {} })).status, 403, 'viewers cannot change the mapping');
let r = await call(PM, 'GET', 'accounting-export', {}, { month: '2026-10', format: 'tally' });
assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.journal.balanced, true);
assert.match(r.json.text, /Acme Pvt Ltd/); assert.equal(r.json.filename, 'Payroll_2026-10_Tally.xml');
r = await call(PM, 'POST', 'save-accounting-mapping', { company: 'Acme (FY26)', ledgers: { salaryExpense: 'Staff Cost', pfPayable: '  ' } });
assert.equal(r.status, 200); assert.equal(r.json.ledgers.salaryExpense, 'Staff Cost'); assert.equal(r.json.ledgers.pfPayable, 'PF Payable', 'blank falls back to the default');
r = await call(PV, 'GET', 'accounting-mapping'); assert.equal(r.json.configured, true); assert.equal(r.json.company, 'Acme (FY26)');
r = await call(PM, 'GET', 'accounting-export', {}, { month: '2026-10', format: 'quickbooks', dateFormat: 'MM/DD/YYYY' });
assert.match(r.json.text, /"Staff Cost",51000.00/); assert.match(r.json.text, /10\/31\/2026/);
r = await call(PM, 'GET', 'accounting-export', {}, { month: '2026-10', format: 'tally' });
assert.match(r.json.text, /Acme \(FY26\)/);
console.log('accounting.export ok');
