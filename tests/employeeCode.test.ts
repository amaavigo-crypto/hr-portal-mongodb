import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLifecycle } from '../api/_lib/lifecycleApi.ts';
import { employeeCodeProblem, nextFreeEmployeeCode, normalizeEmployeeCode, sameEmployeeCode } from '../shared/employeeCode.ts';

// ---------------------------------------------------------------- rules (pure)
assert.equal(normalizeEmployeeCode('  amaa006 '), 'AMAA006');
assert.equal(normalizeEmployeeCode(undefined), '');
assert.equal(employeeCodeProblem('AMAA006'), '');
assert.equal(employeeCodeProblem('e8-014'), '', 'lower case is fine, it is normalised');
assert.equal(employeeCodeProblem('A_1'), '');
assert.match(employeeCodeProblem(''), /Enter an employee code/);
assert.match(employeeCodeProblem('   '), /Enter an employee code/);
assert.match(employeeCodeProblem('A'), /2 to 20/);
assert.match(employeeCodeProblem('A'.repeat(21)), /2 to 20/);
assert.match(employeeCodeProblem('AB CD'), /letters, numbers/);
assert.match(employeeCodeProblem('-AB'), /starting with a letter or number/);
assert.match(employeeCodeProblem('AB/12'), /letters, numbers/);
assert.equal(employeeCodeProblem('A'.repeat(20)), '');
assert.equal(sameEmployeeCode('amaa006', ' AMAA006'), true);
assert.equal(sameEmployeeCode('', ''), false, 'two blanks are not "the same code"');

// the counter skips codes that were set by hand
assert.deepEqual(nextFreeEmployeeCode('AC', 9, []), { code: 'AC009', number: 9 });
assert.deepEqual(nextFreeEmployeeCode('AC', 9, ['AC009']), { code: 'AC010', number: 10 });
assert.deepEqual(nextFreeEmployeeCode('AC', 9, ['ac009', 'AC010', 'AC011']), { code: 'AC012', number: 12 }, 'case-insensitive, runs of taken codes');
assert.deepEqual(nextFreeEmployeeCode('AC', 9, ['AC050']), { code: 'AC009', number: 9 }, 'a code far ahead does not matter');
assert.deepEqual(nextFreeEmployeeCode('AC', 0, []), { code: 'AC001', number: 1 }, 'a bad start number falls back to 1');

// ---------------------------------------------------------------- api
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['lifecycle.manage']);
const LEAVE = tokenFor('u_leave', ['leave.manage']);
const ADMIN = tokenFor('u_admin', [], true);
const EMP = tokenFor('u_emp');
const FOREIGN = tokenFor('u_hr', ['lifecycle.manage'], false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
const person = (uid: string, name: string, empId: string, active = true) =>
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId, title: 'Staff' });
person('u_hr', 'Hema HR', 'E8-001');
person('u_leave', 'Lena Leave', 'E8-002');
person('u_admin', 'Ada Admin', 'E8-003');
person('u_emp', 'Esha Employee', 'E8-006');
person('u_other', 'Omar Other', 'E8-007');
person('u_gone', 'Gita Gone', 'OLD-001', false);
fdb.seed('employees', 'u_foreign', { companyId: 'c2', authUid: 'u_foreign', name: 'Fay Foreign', email: 'f@other.com', active: true, createdAt: '2020-01-01T00:00:00Z', empId: 'E8-100' });

const call = (headers: any, action: string, body: any = {}) => routeLifecycle({ method: 'POST', action, headers, body, query: {} });
const ok = async (headers: any, body: any) => {
  const x = await call(headers, 'set-emp-id', body);
  assert.equal(x.status, 200, JSON.stringify(x.json));
  return x.json;
};
const bad = async (headers: any, body: any, status: number) => {
  const x = await call(headers, 'set-emp-id', body);
  assert.equal(x.status, status, `should be ${status}: ${JSON.stringify(x.json)}`);
  return x.json;
};
const dirCode = async (uid: string) => {
  const x = await routeLifecycle({ method: 'GET', action: 'directory', headers: HR, body: {}, query: { all: '1' } });
  return x.json.people.find((p: any) => p.uid === uid).empId;
};

// who may change a code
await bad(EMP, { uid: 'u_other', empId: 'E8-014' }, 403);
assert.equal(await dirCode('u_other'), 'E8-007', 'a refused change leaves the code alone');

// a normal change shows up in the directory
const first = await ok(HR, { uid: 'u_other', empId: 'E8-014' });
assert.equal(first.empId, 'E8-014');
assert.equal(await dirCode('u_other'), 'E8-014');

// lower case and spaces are tidied
assert.equal((await ok(HR, { uid: 'u_other', empId: ' e8-015 ' })).empId, 'E8-015');
assert.equal(await dirCode('u_other'), 'E8-015');

// leave managers and company admins can do it too
await ok(LEAVE, { uid: 'u_other', empId: 'E8-016' });
await ok(ADMIN, { uid: 'u_other', empId: 'E8-017' });
assert.equal(await dirCode('u_other'), 'E8-017');

// same code again changes nothing
assert.equal((await ok(HR, { uid: 'u_other', empId: 'e8-017' })).unchanged, true);

// duplicates are refused, whatever the case, and the message names the owner
const dup = await bad(HR, { uid: 'u_emp', empId: 'E8-017' }, 409);
assert.match(dup.error, /already belongs to Omar Other/);
await bad(HR, { uid: 'u_emp', empId: 'e8-017' }, 409);
assert.equal(await dirCode('u_emp'), 'E8-006', 'a refused duplicate leaves the code alone');

// a former employee's code stays reserved
const reserved = await bad(HR, { uid: 'u_emp', empId: 'old-001' }, 409);
assert.match(reserved.error, /Gita Gone \(inactive\)/);

// a code given up can be reused by someone else
await ok(HR, { uid: 'u_emp', empId: 'E8-006' });
await ok(HR, { uid: 'u_other', empId: 'E8-020' });
await ok(HR, { uid: 'u_emp', empId: 'E8-017' });
assert.equal(await dirCode('u_emp'), 'E8-017');

// bad input
await bad(HR, { uid: 'u_other', empId: '' }, 400);
await bad(HR, { uid: 'u_other', empId: 'A' }, 400);
await bad(HR, { uid: 'u_other', empId: 'AB CD' }, 400);
await bad(HR, { uid: 'u_other', empId: 'A'.repeat(21) }, 400);
await bad(HR, { uid: 'u_other', empId: '<b>x</b>' }, 400);
await bad(HR, { uid: 'u_missing', empId: 'E8-099' }, 404);

// another company can neither see nor change these people, and codes are only unique inside one company
await bad(FOREIGN, { uid: 'u_other', empId: 'E8-500' }, 404);
assert.equal(await dirCode('u_other'), 'E8-020');
await ok(FOREIGN, { uid: 'u_foreign', empId: 'E8-020' });
assert.equal(fdb.all('employees').find((e: any) => e.authUid === 'u_foreign')!.empId, 'E8-020', 'the same code may exist in another company');

// the first old code is remembered once, and never overwritten
const prof = () => fdb.all('employeeProfiles').find((p: any) => p.uid === 'u_other');
assert.equal(prof()!.oldCode, 'E8-007', 'the original code is kept as the old code');
assert.equal(prof()!.companyId, CID);

// every change is in the audit trail
const trail = fdb.all('leaveAudit').filter((a: any) => a.action === 'EMP_CODE_CHANGED' && a.entityId === 'u_other');
assert.equal(trail.length, 5, 'one entry per real change (the unchanged and refused ones are not logged)');
assert.deepEqual([trail[0].oldValue, trail[0].newValue], ['E8-007', 'E8-014']);
assert.equal(trail[0].actorUid, 'u_hr');
assert.ok(trail.every((a: any) => a.companyId === CID));

console.log('employee code: ok');
