import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePrefixed } from '../api/_lib/prefixRouter.ts';
import { cleanDefs, cleanValues, missingRequired } from '../shared/customFields.ts';
import { cleanDef, matches, runReport, type CatalogField } from '../shared/reportBuilder.ts';

// ---- custom field rules
assert.match(cleanDefs([{ label: '', type: 'TEXT' }]).error!, /label/);
assert.match(cleanDefs([{ label: 'X', type: 'NOPE' }]).error!, /type/);
assert.match(cleanDefs([{ label: 'X', type: 'SELECT', options: ['a'] }]).error!, /two options/);
const d = cleanDefs([{ label: 'Blood group', type: 'SELECT', options: ['A+', 'B+', 'A+'], selfEdit: true }, { label: 'Blood group', type: 'TEXT' }, { label: 'Shoe size', type: 'NUMBER' }, { label: 'Birthday', type: 'DATE', selfView: true, required: true }, { label: '2fa', type: 'BOOLEAN' }]).defs;
assert.deepEqual(d.map((x) => x.key), ['blood_group', 'blood_group_2', 'shoe_size', 'birthday', 'f_2fa'], 'keys are unique and never start with a digit');
assert.equal(d[0].selfView, true, 'self-edit implies self-view'); assert.deepEqual(d[0].options, ['A+', 'B+']);
assert.match(cleanValues(d, { shoe_size: 'abc' }).error!, /number/); assert.match(cleanValues(d, { birthday: '2026-02-31' }).error!, /date/);
assert.match(cleanValues(d, { blood_group: 'Z' }).error!, /options/); assert.match(cleanValues(d, { f_2fa: 'yes' }).error!, /yes or no/); assert.match(cleanValues(d, { birthday: '' }).error!, /required/);
assert.deepEqual(cleanValues(d, { shoe_size: '42', blood_group: 'B+', unknown: 1, birthday: '1990-05-01' }).values, { blood_group: 'B+', shoe_size: 42, birthday: '1990-05-01' });
assert.deepEqual(cleanValues(d, { shoe_size: 42, blood_group: 'B+' }, (x) => x.selfEdit).values, { blood_group: 'B+' }, 'only the allowed fields are read');
assert.deepEqual(missingRequired(d, {}), ['Birthday']);

// ---- report engine
const cat: CatalogField[] = [{ key: 'name', label: 'Name', kind: 'text' }, { key: 'dept', label: 'Department', kind: 'text' }, { key: 'pay', label: 'Pay', kind: 'number' }, { key: 'joined', label: 'Joined', kind: 'date' }, { key: 'active', label: 'Active', kind: 'bool' }];
const rows = [
  { name: 'Asha', dept: 'Ops', pay: 100, joined: '2022-01-10', active: true }, { name: 'bela', dept: 'Ops', pay: 300, joined: '2023-06-01', active: true },
  { name: 'Chetan', dept: 'Sales', pay: 200, joined: '2021-03-15', active: false }, { name: 'Dev', dept: '', pay: null, joined: '', active: true },
];
const run = (raw: any) => { const c = cleanDef(raw, cat); assert.ok(c.def, c.error); return runReport(c.def!, cat, rows); };
assert.match(cleanDef({ columns: ['nope'] }, cat).error!, /column/);
assert.deepEqual(run({ columns: ['name'], filters: [{ field: 'dept', op: 'eq', value: 'ops' }] }).rows.map((r) => r.name), ['Asha', 'bela'], 'text matches ignore case');
assert.equal(run({ columns: ['name'], filters: [{ field: 'pay', op: 'gt', value: '150' }] }).rows.length, 2);
assert.equal(run({ columns: ['name'], filters: [{ field: 'pay', op: 'empty' }] }).rows[0].name, 'Dev');
assert.equal(run({ columns: ['name'], filters: [{ field: 'joined', op: 'gte', value: '2022-01-01' }] }).rows.length, 2);
assert.equal(run({ columns: ['name'], filters: [{ field: 'active', op: 'eq', value: 'false' }] }).rows[0].name, 'Chetan');
assert.equal(run({ columns: ['name'], filters: [{ field: 'name', op: 'contains', value: 'EL' }] }).rows[0].name, 'bela');
assert.equal(run({ columns: ['name'], filters: [{ field: 'dept', op: 'neq', value: 'Ops' }] }).rows.length, 2, 'blank is not Ops');
assert.deepEqual(run({ columns: ['name', 'pay'], sort: { field: 'pay', dir: 'desc' } }).rows.map((r) => r.name), ['bela', 'Chetan', 'Asha', 'Dev'], 'blanks sort last');
assert.equal(run({ columns: ['name'], filters: [{ field: 'zzz', op: 'eq', value: 'x' }, { field: 'name', op: 'bogus' }] }).rows.length, 4, 'unknown fields and operators are dropped');
let g = run({ columns: [], group: { by: 'dept', agg: 'sum', field: 'pay' } });
assert.deepEqual(g.rows.map((r: any) => [r.dept, r.value]), [['Ops', 400], ['Sales', 200], ['(blank)', null]].filter((x) => x[1] !== undefined).map((x) => x) as any);
g = run({ columns: [], group: { by: 'dept', agg: 'count' } }); assert.equal((g.rows as any[]).find((r) => r.dept === 'Ops').value, 2);
g = run({ columns: [], group: { by: 'dept', agg: 'avg', field: 'pay' } }); assert.equal((g.rows as any[]).find((r) => r.dept === 'Ops').value, 200);
assert.match(cleanDef({ columns: [], group: { by: 'dept', agg: 'sum', field: 'name' } }, cat).error!, /number field/);
assert.equal(matches({ pay: 'x' }, { field: 'pay', op: 'gt', value: '1' }, 'number'), false);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const CF = tok('hr', ['custom.manage', 'report.manage']), U1 = tok('u1'), RB = tok('rb', ['report.manage']), LR = tok('lr', ['report.manage', 'leave.report']), PV = tok('pv', ['report.manage', 'payroll.view']);
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
for (const [uid, name, dept] of [['hr', 'Hema', 'HR'], ['u1', 'Asha', 'Ops'], ['u2', 'Bela', 'Ops'], ['rb', 'Rita', 'HR'], ['lr', 'Lata', 'HR'], ['pv', 'Pia', 'HR']]) fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name, email: `${uid}@a.com`, empId: `E-${uid}`, departmentName: dept, active: true, createdAt: '2021-01-01T00:00:00Z' });
fdb.seed('leaveProfiles', 'c1__u1', { companyId: 'c1', uid: 'u1', managerUid: 'hr', joinDate: '2022-02-02' });
fdb.seed('leaveRequests', 'r1', { id: 'r1', companyId: 'c1', uid: 'u1', name: 'Asha', typeName: 'Casual', from: '2026-11-03', to: '2026-11-04', days: 2, status: 'APPROVED' });
fdb.seed('payrollRuns', 'c1__2026-10', { companyId: 'c1', month: '2026-10', status: 'LOCKED' });
fdb.seed('payrollRunLines', 'c1__2026-10__u1', { companyId: 'c1', month: '2026-10', uid: 'u1', employee: { name: 'Asha', empId: 'E-u1', department: 'Ops' }, line: { gross: 50000, totalDeductions: 5000, net: 45000, tds: 0, employerCost: 56000, statutory: { pfEmployee: 1800, esicEmployee: 0, pt: 200 } } });
const call = async (h: any, method: string, action: string, body: any = {}, query: any = {}) => (await routePrefixed(`config-${action}`, { method, query, body, headers: h }))!;

// custom fields
assert.equal((await call(U1, 'POST', 'save-fields', { fields: [] })).status, 403);
assert.equal((await call(CF, 'POST', 'save-fields', { fields: [{ label: 'X', type: 'NOPE' }] })).status, 400);
let r = await call(CF, 'POST', 'save-fields', { fields: [
  { label: 'Blood group', type: 'SELECT', options: ['A+', 'B+'], selfEdit: true }, { label: 'Emergency contact', type: 'TEXT', selfEdit: true }, { label: 'Grade', type: 'TEXT' }, { label: 'Hobby', type: 'TEXT', selfView: true }] });
assert.equal(r.status, 200); assert.equal(r.json.defs.length, 4);
r = await call(U1, 'GET', 'fields'); assert.deepEqual(r.json.defs.map((x: any) => x.key), ['blood_group', 'emergency_contact', 'hobby'], 'Grade is hidden from the employee');
assert.equal((await call(U1, 'POST', 'save-field-values', { values: { grade: 'G7' } })).status, 403, 'employees cannot set HR-only fields');
assert.equal((await call(U1, 'POST', 'save-field-values', { values: { blood_group: 'Z' } })).status, 400);
assert.equal((await call(U1, 'POST', 'save-field-values', { values: { blood_group: 'B+', emergency_contact: '98200 11111' } })).status, 200);
assert.equal((await call(U1, 'POST', 'save-field-values', { uid: 'u2', values: { blood_group: 'A+' } })).status, 403, 'not for someone else');
assert.equal((await call(CF, 'POST', 'save-field-values', { uid: 'u1', values: { grade: 'G7' } })).status, 200);
assert.equal((await call(CF, 'POST', 'save-field-values', { uid: 'ghost', values: { grade: 'G7' } })).status, 404);
r = await call(CF, 'GET', 'field-values', {}, { uid: 'u1' }); assert.equal(r.json.values.grade, 'G7'); assert.equal(r.json.values.blood_group, 'B+');
assert.equal((await call(U1, 'GET', 'field-values', {}, { uid: 'u2' })).status, 403);
assert.equal((await call(U1, 'GET', 'field-values')).json.values.grade, undefined, 'own view omits HR-only fields');
assert.equal((await call(tok('x', ['custom.manage'], 'c2'), 'GET', 'field-values', {}, { uid: 'u1' })).status, 404, 'other company');

// reports
assert.equal((await call(U1, 'GET', 'report-datasets')).json.items.length, 0, 'an ordinary employee has no datasets');
assert.deepEqual((await call(RB, 'GET', 'report-datasets')).json.items.map((x: any) => x.key), ['employees']);
assert.deepEqual((await call(LR, 'GET', 'report-datasets')).json.items.map((x: any) => x.key), ['employees', 'leave', 'attendance']);
assert.deepEqual((await call(PV, 'GET', 'report-datasets')).json.items.map((x: any) => x.key), ['employees', 'payroll']);
assert.ok((await call(CF, 'GET', 'report-datasets')).json.items[0].fields.some((f: any) => f.key === 'cf_grade'), 'custom fields appear in the employee catalog');
r = await call(RB, 'POST', 'report-run', { def: { dataset: 'employees', columns: ['name', 'department', 'manager', 'cf_grade'], filters: [{ field: 'department', op: 'eq', value: 'ops' }] } });
assert.equal(r.status, 200, 'report.manage can report on every custom field'); assert.equal(r.json.rows.length, 2);
r = await call(CF, 'POST', 'report-run', { def: { dataset: 'employees', columns: ['name', 'manager', 'joinDate', 'cf_grade'], filters: [{ field: 'department', op: 'eq', value: 'ops' }], sort: { field: 'name', dir: 'asc' } } });
assert.equal(r.status, 200, JSON.stringify(r.json)); assert.deepEqual(r.json.rows.map((x: any) => x.name), ['Asha', 'Bela']);
assert.equal(r.json.rows[0].manager, 'Hema'); assert.equal(r.json.rows[0].cf_grade, 'G7'); assert.equal(r.json.rows[0].joinDate, '2022-02-02');
assert.equal((await call(RB, 'POST', 'report-run', { def: { dataset: 'payroll', columns: ['name', 'gross'] }, from: '2026-10-01', to: '2026-10-31' })).status, 403, 'report.manage alone cannot open salary data');
assert.equal((await call(RB, 'POST', 'report-run', { def: { dataset: 'leave', columns: ['name'] }, from: '2026-11-01', to: '2026-11-30' })).status, 403);
r = await call(PV, 'POST', 'report-run', { def: { dataset: 'payroll', columns: [], group: { by: 'department', agg: 'sum', field: 'net' } }, from: '2026-10-01', to: '2026-10-31' });
assert.equal(r.status, 200); assert.deepEqual(r.json.rows, [{ department: 'Ops', value: 45000 }]);
assert.equal((await call(PV, 'POST', 'report-run', { def: { dataset: 'payroll', columns: ['name'] }, from: '2026-10-01', to: '2027-12-31' })).status, 400, 'range cap');
assert.equal((await call(PV, 'POST', 'report-run', { def: { dataset: 'payroll', columns: ['name'] } })).status, 400, 'dates required');
r = await call(LR, 'POST', 'report-run', { def: { dataset: 'leave', columns: ['name', 'type', 'days'] }, from: '2026-11-01', to: '2026-11-30' });
assert.deepEqual(r.json.rows, [{ name: 'Asha', type: 'Casual', days: 2 }]);
assert.equal((await call(LR, 'POST', 'report-run', { def: { dataset: 'nope', columns: ['x'] } })).status, 400);

// saved reports
assert.equal((await call(U1, 'POST', 'save-report', { name: 'x', def: { dataset: 'employees', columns: ['name'] } })).status, 403);
assert.equal((await call(RB, 'POST', 'save-report', { name: '', def: { dataset: 'employees', columns: ['name'] } })).status, 400);
assert.equal((await call(RB, 'POST', 'save-report', { name: 'Pay', def: { dataset: 'payroll', columns: ['name'] } })).status, 403, 'cannot save a report on data you cannot read');
r = await call(RB, 'POST', 'save-report', { name: 'Headcount', shared: true, def: { dataset: 'employees', columns: [], group: { by: 'department', agg: 'count' } } }); assert.equal(r.status, 200); const rid = r.json.id;
r = await call(LR, 'POST', 'save-report', { name: 'Private', shared: false, def: { dataset: 'employees', columns: ['name'] } }); const pid = r.json.id;
assert.equal((await call(RB, 'GET', 'reports')).json.items.length, 2, 'report.manage sees them all');
assert.equal((await call(U1, 'GET', 'reports')).json.items.length, 0);
r = await call(RB, 'POST', 'report-run', { id: rid }); assert.equal(r.status, 200); assert.equal(r.json.rows.find((x: any) => x.department === 'Ops').value, 2);
assert.equal((await call(U1, 'POST', 'report-run', { id: rid })).status, 403, 'running needs the dataset permission');
assert.equal((await call(RB, 'POST', 'delete-report', { id: pid })).status, 404, 'cannot delete someone else\'s report');
assert.equal((await call(RB, 'POST', 'delete-report', { id: rid })).status, 200);
assert.equal((await call(tok('x', ['report.manage'], 'c2'), 'POST', 'report-run', { id: pid })).status, 404);
console.log('config ok');
