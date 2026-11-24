import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';
import { cycleOf, istToday } from '../shared/leaveEngine.ts';

// Moving people between the organisations of one account (single and several at once).

const fdb = new FakeFirestore();
const claims = new Map<string, any>();
const revoked: string[] = [];
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64');
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: claims.get(uid) || {} }),
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map(({ uid }) => ({ uid, customClaims: claims.get(uid) || {} })) }),
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { claims.set(uid, c); },
    revokeRefreshTokens: async (uid: string) => { revoked.push(uid); },
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';
const tokenFor = (uid: string) => ({ authorization: `Bearer ${b64({ uid, email: `${uid}@x.com`, ...(claims.get(uid) || {}) })}` });
const call = (action: string, headers: any, body: any = {}) => routeTenant({ method: 'POST', action, headers, body, origin: 'https://app.example' } as any);
const today = istToday();

// ---------------------------------------------------------------- data
const leaveType = (id: string, name: string, code: string) => ({ id, code, name, paid: true, active: true, requiresBalance: true, halfDay: true, dayCounting: 'WORKING', minNoticeDays: 0, maxDaysPerRequest: 0, docRequiredAfterDays: 0, gender: 'ANY', minServiceDays: 0, allowNegative: false });
const settings = (types: any[]) => ({ yearStartMonth: 4, sandwichRule: false, locations: [], policies: [], types });
const seedOrg = (id: string, name: string, accountId: string, types: any[], prefix: string, next: number) => {
  fdb.seed('companies', id, { id, name, status: 'ACTIVE', modules: ['talent-acquisition'], accountId, adminEmail: `${id}@x.com`, employeeIdPrefix: prefix, nextEmployeeNumber: next });
  fdb.seed('roles', `${id}_employee`, { id: `${id}_employee`, companyId: id, name: 'Employee', permissions: [], portal: 'EMPLOYEE', isAdmin: false });
  fdb.seed('leaveSettings', id, settings(types));
};
fdb.seed('accounts', 'acc1', { id: 'acc1', name: 'Group', ownerEmail: 'g@x.com', orgLimit: 5, groupAdminUids: ['ga'], createdAt: 't', updatedAt: 't' });
fdb.seed('accounts', 'acc2', { id: 'acc2', name: 'Other', ownerEmail: 'o@x.com', orgLimit: 1, groupAdminUids: [], createdAt: 't', updatedAt: 't' });
seedOrg('A', 'Alpha Ltd', 'acc1', [leaveType('a_cl', 'Casual Leave', 'CL')], 'AL', 3);
seedOrg('B', 'Beta Ltd', 'acc1', [leaveType('b_cl', 'Casual Leave', 'CL'), leaveType('b_sl', 'Sick Leave', 'SL')], 'BE', 9);
seedOrg('C', 'Gamma Ltd', 'acc2', [], 'GA', 1);

const emp = (uid: string, companyId: string, extra: any = {}) => fdb.seed('employees', uid, {
  id: uid, authUid: uid, companyId, companyName: companyId, email: `${uid}@x.com`, name: `Name ${uid}`, empId: `${companyId}-${uid}`.toUpperCase(),
  roleIds: [`${companyId}_employee`], active: true, departmentId: 'd1', departmentName: 'Ops', title: 'Staff', ...extra,
});
emp('ga', 'A', { roleIds: [] });
claims.set('ga', { cid: 'A', cs: 'ACTIVE', perms: [], adm: true, aid: 'acc1', ga: true, hid: 'A' });
emp('p1', 'B'); emp('p2', 'B'); emp('p3', 'B'); emp('p4', 'B'); emp('gone', 'B', { active: false }); emp('hr_b', 'B'); emp('outsider', 'C');
claims.set('hr_b', { cid: 'B', cs: 'ACTIVE', perms: ['lifecycle.manage'], adm: false });
claims.set('hr_a', { cid: 'A', cs: 'ACTIVE', perms: ['lifecycle.manage'], adm: false });
emp('hr_a', 'A');
claims.set('plain', { cid: 'B', cs: 'ACTIVE', perms: [], adm: false });
emp('plain', 'B');

// p1 has a full profile in B, balances, a pending request, manages p2 and heads a department
fdb.seed('employeeProfiles', 'B__p1', { companyId: 'B', uid: 'p1', machineCode: 'M-77', firstName: 'Pia' });
fdb.seed('employeePersonal', 'B__p1', { companyId: 'B', uid: 'p1', bloodGroup: 'B+' });
fdb.seed('employeeIdentities', 'B__p1__PAN', { companyId: 'B', uid: 'p1', type: 'PAN', number: 'ABCDE1234F', status: 'APPROVED' });
fdb.seed('employeeIdentityFiles', 'f1', { id: 'f1', companyId: 'B', uid: 'p1', type: 'PAN', kb: 10 });
fdb.seed('employeeIdentityData', 'f1', { companyId: 'B', uid: 'p1', dataUrl: 'data:image/png;base64,AAAA' });
fdb.seed('employeeFamily', 'fam1', { id: 'fam1', companyId: 'B', uid: 'p1', name: 'Sample Parent', relation: 'Father' });
fdb.seed('employeeQualifications', 'q1', { id: 'q1', companyId: 'B', uid: 'p1', qualification: 'MBA', hasDocument: true });
fdb.seed('employeeQualificationData', 'q1', { companyId: 'B', uid: 'p1', dataUrl: 'data:image/png;base64,BBBB' });
const cycB = (typeId: string) => cycleOf(today, 4).key;
const ledger = (id: string, companyId: string, uid: string, typeId: string, delta: number) => fdb.seed('leaveLedger', id, { companyId, uid, typeId, cycle: cycB(typeId), delta, kind: 'ACCRUAL', date: today, createdAt: 't' });
ledger('l1', 'B', 'p1', 'b_cl', 7); ledger('l2', 'B', 'p1', 'b_sl', 4);
ledger('l3', 'B', 'p3', 'b_cl', 5); ledger('l4', 'B', 'p4', 'b_cl', 2);
fdb.seed('leaveRequests', 'r1', { companyId: 'B', uid: 'p1', status: 'PENDING', typeName: 'Casual Leave', from: today, to: today, days: 1 });
fdb.seed('leaveRequests', 'r2', { companyId: 'B', uid: 'p1', status: 'APPROVED', typeName: 'Casual Leave', from: '2026-01-05', to: '2026-01-05', days: 1 });
fdb.seed('leaveProfiles', 'B__p2', { companyId: 'B', uid: 'p2', managerUid: 'p1' });
fdb.seed('leaveProfiles', 'B__p1', { companyId: 'B', uid: 'p1', gender: 'F', managerUid: '' });
fdb.seed('departments', 'dep1', { id: 'dep1', companyId: 'B', name: 'Ops', headUserId: 'p1' });
const GA = () => tokenFor('ga');
const row = (col: string, id: string) => fdb.all(col).find((r: any) => r.id === id);

// ---------------------------------------------------------------- who may move people
assert.equal((await call('transfer-people', tokenFor('hr_b'), { toCompanyId: 'A', uids: ['p1'] })).status, 403, 'HR alone cannot move people directly');
assert.equal((await call('transfer-people', tokenFor('plain'), { toCompanyId: 'A', uids: ['p1'] })).status, 403);

// batch-level refusals change nothing
const refused = [
  [{ toCompanyId: 'C', uids: ['p1'] }, 403],            // another account
  [{ toCompanyId: 'nope', uids: ['p1'] }, 404],
  [{ toCompanyId: 'A', uids: [] }, 400],
  [{ toCompanyId: 'A', uids: ['p1'], effectiveDate: '2999-01-01' }, 400],
  [{ toCompanyId: 'A', uids: ['p1'], effectiveDate: 'soon' }, 400],
  [{ toCompanyId: 'A', uids: ['p1'], carry: 'maybe' }, 400],
] as const;
for (const [b, s] of refused) assert.equal((await call('transfer-people', GA(), b as any)).status, s, JSON.stringify(b));
assert.equal(row('employees', 'p1').companyId, 'B');

// per-person refusals do not stop the rest
const mixed = await call('transfer-people', GA(), { toCompanyId: 'A', uids: ['outsider', 'gone', 'ga', 'nobody', 'p4'] });
assert.equal(mixed.status, 200);
const byUid = Object.fromEntries(mixed.json.results.map((r: any) => [r.uid, r]));
assert.match(byUid.outsider.error, /not in an organisation of your account/);
assert.match(byUid.gone.error, /inactive/);
assert.match(byUid.ga.error, /yourself/);
assert.match(byUid.nobody.error, /not found/);
assert.equal(byUid.p4.ok, true, 'the valid person still moved');
assert.equal(mixed.json.moved, 1); assert.equal(mixed.json.failed, 4);
assert.equal(row('employees', 'gone').companyId, 'B');
assert.equal(row('employees', 'outsider').companyId, 'C');

// ---------------------------------------------------------------- one person, balances carried for chosen types only
const one = await call('transfer-people', GA(), { toCompanyId: 'A', uids: ['p1'], carry: 'choose', carryTypes: ['Casual Leave', 'Sick Leave'], note: 'Joining the Alpha team' });
assert.equal(one.status, 200, JSON.stringify(one.json));
const r1 = one.json.results[0];
assert.equal(r1.ok, true);
assert.equal(r1.fromEmpId, 'B-P1');
assert.equal(r1.toEmpId, 'AL004', 'the new organisation\'s counter issues the next code (p4 took AL003)');
assert.deepEqual(r1.carried, [{ type: 'Casual Leave', days: 7 }]);
assert.equal(r1.notCarried.length, 1);
assert.match(r1.notCarried[0], /Sick Leave/);
assert.equal(r1.cancelledRequests, 1);
assert.equal(r1.reportsCleared, 1);
assert.equal(r1.departmentsCleared, 1);

// the same record moved: same id, new organisation, basic role, old code remembered
const e1 = row('employees', 'p1');
assert.equal(e1.companyId, 'A'); assert.equal(e1.companyName, 'Alpha Ltd'); assert.equal(e1.empId, 'AL004'); assert.equal(e1.previousEmpId, 'B-P1');
assert.deepEqual(e1.roleIds, ['A_employee']); assert.equal(e1.departmentName, ''); assert.equal(e1.active, true);
assert.equal(claims.get('p1').cid, 'A', 'claims point at the new organisation'); assert.equal(claims.get('p1').adm, false);
assert.ok(revoked.includes('p1'), 'old sessions are revoked so the new claims apply');
assert.equal(row('companies', 'A').nextEmployeeNumber, 5, 'A\'s counter moved past both transferred people (AL003 for p4, AL004 for p1)');

// profile data was copied, the old organisation keeps its own copy
const newProf = row('employeeProfiles', 'A__p1');
assert.equal(newProf.companyId, 'A'); assert.equal(newProf.machineCode, 'M-77'); assert.equal(newProf.oldCode, 'B-P1');
assert.ok(row('employeeProfiles', 'B__p1'), 'history stays in the old organisation');
assert.equal(row('employeePersonal', 'A__p1').bloodGroup, 'B+');
assert.equal(row('employeeIdentities', 'A__p1__PAN').number, 'ABCDE1234F');
assert.ok(row('employeeIdentities', 'B__p1__PAN'));
const newFile = fdb.all('employeeIdentityFiles').find((f: any) => f.companyId === 'A' && f.uid === 'p1')!;
assert.ok(newFile && newFile.id !== 'f1', 'files get new ids');
assert.equal(row('employeeIdentityData', newFile.id).dataUrl, 'data:image/png;base64,AAAA', 'picture data copied too');
assert.ok(fdb.all('employeeFamily').find((f: any) => f.companyId === 'A' && f.name === 'Sample Parent'));
const newQ = fdb.all('employeeQualifications').find((q: any) => q.companyId === 'A' && q.uid === 'p1')!;
assert.equal(row('employeeQualificationData', newQ.id).dataUrl, 'data:image/png;base64,BBBB');
assert.ok(row('employeeQualifications', 'q1') && row('employeeQualificationData', 'q1'), 'originals untouched');

// leave: opening balance in A for the matching type; B's balance closed out; nothing carried for the unmatched type
const openA = fdb.all('leaveLedger').filter((l: any) => l.companyId === 'A' && l.uid === 'p1');
assert.equal(openA.length, 1); assert.equal(openA[0].delta, 7); assert.equal(openA[0].kind, 'OPENING'); assert.equal(openA[0].typeId, 'a_cl'); assert.match(openA[0].note, /Carried from Beta Ltd/);
const sumB = (typeId: string) => fdb.all('leaveLedger').filter((l: any) => l.companyId === 'B' && l.uid === 'p1' && l.typeId === typeId).reduce((n: number, l: any) => n + l.delta, 0);
assert.equal(sumB('b_cl'), 0, 'the days are not counted twice'); assert.equal(sumB('b_sl'), 4, 'uncarried balance stays where it was');

// pending items and references in the old organisation
assert.equal(row('leaveRequests', 'r1').status, 'CANCELLED'); assert.equal(row('leaveRequests', 'r2').status, 'APPROVED', 'history is left alone');
assert.equal(row('leaveProfiles', 'B__p2').managerUid, '', 'people who reported to them lose that manager');
assert.equal(row('departments', 'dep1').headUserId, '');
const lp = row('leaveProfiles', 'A__p1'); assert.equal(lp.managerUid, ''); assert.equal(lp.joinDate, today); assert.equal(lp.gender, 'F');

// audit and employment history
const hist = fdb.all('employmentHistory').filter((h: any) => h.uid === 'p1');
assert.equal(hist.length, 1); assert.equal(hist[0].fromCompanyName, 'Beta Ltd'); assert.equal(hist[0].toEmpId, 'AL004'); assert.equal(hist[0].note, 'Joining the Alpha team');
assert.ok(fdb.all('leaveAudit').find((a: any) => a.companyId === 'B' && a.entityId === 'p1' && a.action === 'TRANSFERRED_OUT'));
assert.ok(fdb.all('leaveAudit').find((a: any) => a.companyId === 'A' && a.entityId === 'p1' && a.action === 'TRANSFERRED_IN'));

// moving again to the same organisation is refused
const again = await call('transfer-people', GA(), { toCompanyId: 'A', uids: ['p1'] });
assert.match(again.json.results[0].error, /Already in that organisation/);

// ---------------------------------------------------------------- previous employment: HR/admin of the NEW organisation only
const prev = await call('previous-employment', tokenFor('hr_a'), { uid: 'p1' });
assert.equal(prev.status, 200, JSON.stringify(prev.json));
assert.equal(prev.json.employments.length, 1);
assert.equal(prev.json.employments[0].organisation, 'Beta Ltd');
assert.equal(prev.json.employments[0].leave.length, 2, 'leave history from the old organisation');
assert.ok(prev.json.employments[0].audit.length >= 1);
assert.ok(!JSON.stringify(prev.json).includes('payroll'), 'no payroll or salary data');
assert.equal((await call('previous-employment', tokenFor('hr_b'), { uid: 'p1' })).status, 404, 'HR of the old organisation no longer manages them');
assert.equal((await call('previous-employment', tokenFor('plain'), { uid: 'p1' })).status, 403, 'needs HR rights');
assert.equal((await call('previous-employment', tokenFor('hr_a'), { uid: 'p2' })).status, 404, 'not someone in their organisation');

// ---------------------------------------------------------------- several at once: batch rule + per-person override
const bulk = await call('transfer-people', GA(), { toCompanyId: 'A', uids: ['p2', 'p3'], carry: 'all', perPerson: { p3: 'none' } });
assert.equal(bulk.status, 200); assert.equal(bulk.json.moved, 2);
assert.equal(bulk.json.results.find((r: any) => r.uid === 'p2').toEmpId, 'AL005');
assert.equal(bulk.json.results.find((r: any) => r.uid === 'p3').toEmpId, 'AL006');
assert.equal(fdb.all('leaveLedger').filter((l: any) => l.companyId === 'A' && l.uid === 'p3').length, 0, 'override: nothing carried for p3');
assert.equal(row('employees', 'p3').companyId, 'A');

// ---------------------------------------------------------------- propose (HR) then approve (group admin)
fdb.seed('employees', 'q9', { id: 'q9', authUid: 'q9', companyId: 'A', companyName: 'A', email: 'q9@x.com', name: 'Q Nine', empId: 'A-Q9', roleIds: ['A_employee'], active: true });
assert.equal((await call('transfer-propose', tokenFor('plain'), { toCompanyId: 'A', uids: ['q9'] })).status, 403, 'no HR right');
assert.equal((await call('transfer-propose', tokenFor('hr_a'), { toCompanyId: 'C', uids: ['q9'] })).status, 403, 'other account');
assert.equal((await call('transfer-propose', tokenFor('hr_a'), { toCompanyId: 'B', uids: ['plain'] })).status, 403, 'can only propose people from their own organisation');
const prop = await call('transfer-propose', tokenFor('hr_a'), { toCompanyId: 'B', uids: ['q9'], carry: 'none', note: 'Moving to Beta' });
assert.equal(prop.status, 200, JSON.stringify(prop.json));
assert.equal(row('employees', 'q9').companyId, 'A', 'a proposal moves nobody');
assert.equal((await call('transfer-decide', tokenFor('hr_a'), { id: prop.json.id, approve: true })).status, 403, 'only the group admin decides');
const listG = await routeTenant({ method: 'GET', action: 'transfer-requests', headers: GA(), body: {} } as any);
assert.equal(listG.json.requests.filter((r: any) => r.status === 'PENDING').length, 1);
const listHr = await routeTenant({ method: 'GET', action: 'transfer-requests', headers: tokenFor('hr_a'), body: {} } as any);
assert.equal(listHr.json.requests.length, 1, 'HR sees their own organisation\'s requests');
const approved = await call('transfer-decide', GA(), { id: prop.json.id, approve: true });
assert.equal(approved.status, 200, JSON.stringify(approved.json));
assert.equal(approved.json.moved, 1);
assert.equal(row('employees', 'q9').companyId, 'B');
assert.equal(row('transferRequests', prop.json.id).status, 'APPROVED');
assert.equal((await call('transfer-decide', GA(), { id: prop.json.id, approve: true })).status, 409, 'cannot be decided twice');

fdb.seed('employees', 'q8', { id: 'q8', authUid: 'q8', companyId: 'A', companyName: 'A', email: 'q8@x.com', name: 'Q Eight', empId: 'A-Q8', roleIds: ['A_employee'], active: true });
const prop2 = await call('transfer-propose', tokenFor('hr_a'), { toCompanyId: 'B', uids: ['q8'] });
const rej = await call('transfer-decide', GA(), { id: prop2.json.id, approve: false, note: 'Not now' });
assert.equal(rej.status, 200); assert.equal(rej.json.status, 'REJECTED');
assert.equal(row('employees', 'q8').companyId, 'A', 'a rejected proposal moves nobody');

// ---------------------------------------------------------------- what the transfer screen loads
const sib = await routeTenant({ method: 'GET', action: 'sibling-organisations', headers: tokenFor('hr_a'), body: {} } as any);
assert.equal(sib.status, 200);
assert.deepEqual(sib.json.organisations.map((o: any) => o.id), ['B'], 'only the other organisations of the same account (not C)');
assert.equal(sib.json.direct, false, 'HR proposes');
assert.deepEqual(sib.json.leaveTypes, ['Casual Leave']);
assert.equal((await routeTenant({ method: 'GET', action: 'sibling-organisations', headers: tokenFor('plain'), body: {} } as any)).status, 403);
const sibGa = await routeTenant({ method: 'GET', action: 'sibling-organisations', headers: GA(), body: {} } as any);
assert.equal(sibGa.json.direct, true, 'the group admin moves people directly');

console.log('org transfer: ok');
