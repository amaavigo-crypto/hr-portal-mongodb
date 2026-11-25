import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';
import { effectivePermissions } from '../shared/permissions.ts';

delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
const fdb = new FakeFirestore();
const users = new Map<string, { uid: string; email: string; claims: any }>();
const tokenFor = (uid: string, perms: string[], adm = false) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: 'c1', cs: 'ACTIVE', perms, adm })).toString('base64')}` });
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, email: users.get(uid)!.email, disabled: false, customClaims: users.get(uid)!.claims, metadata: {} }),
    getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); },
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { users.get(uid)!.claims = c; },
    revokeRefreshTokens: async () => undefined,
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

fdb.seed('companies', 'c1', { id: 'c1', name: 'Acme', status: 'ACTIVE', modules: ['document-version-control', 'talent-acquisition'], adminEmail: 'boss@acme.com', employeeIdPrefix: 'AC', nextEmployeeNumber: 9 });
fdb.seed('roles', 'c1_admin', { id: 'c1_admin', companyId: 'c1', name: 'admin', permissions: [], portal: 'CREATOR', isAdmin: true });
fdb.seed('roles', 'c1_employee', { id: 'c1_employee', companyId: 'c1', name: 'employee', permissions: ['doc.acknowledge'], portal: 'EMPLOYEE', isAdmin: false });
fdb.seed('roles', 'c1_hr', { id: 'c1_hr', companyId: 'c1', name: 'hr', permissions: ['roles.manage', 'payroll.view', 'leave.manage'], portal: 'CREATOR', isAdmin: false });
const emp = (uid: string, roleIds: string[]) => {
  users.set(uid, { uid, email: `${uid}@acme.com`, claims: {} });
  fdb.seed('employees', uid, { id: uid, authUid: uid, companyId: 'c1', companyName: 'Acme', empId: `AC-${uid}`, loginId: `${uid}@acme.com`, name: uid, email: `${uid}@acme.com`, title: '', departmentId: '', departmentName: '', roleIds, roleNames: [], role: 'EMPLOYEE', perms: [], authorizedModules: 'ALL', active: true, createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' });
};
emp('boss', ['c1_admin']); emp('hr', ['c1_hr']); emp('hr2', ['c1_hr']); emp('ann', ['c1_employee']);
const BOSS = tokenFor('boss', [], true);
const HR = tokenFor('hr', ['roles.manage', 'payroll.view', 'leave.manage']);
const call = (headers: any, perms: string[], uid = 'ann') => routeTenant({ method: 'POST', action: 'set-extra-permissions', headers, body: { userId: uid, permissions: perms }, origin: 'https://x' }) as Promise<any>;

// pure union
assert.deepEqual(effectivePermissions([{ permissions: ['doc.acknowledge'], isAdmin: false }], ['document-version-control'], ['payroll.view']), ['doc.acknowledge', 'payroll.view']);
assert.deepEqual(effectivePermissions([], [], ['not.real', 'perf.view']), [], 'unknown and retired extras are ignored');

// admin grants one extra; it reaches the sign-in token and the record
let r = await call(BOSS, ['payroll.view']);
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.deepEqual(users.get('ann')!.claims.perms.sort(), ['doc.acknowledge', 'payroll.view']);
assert.deepEqual(fdb.all('employees').find((e) => e.id === 'ann')!.extraPermissions, ['payroll.view']);
assert.equal(fdb.all('employees').find((e) => e.id === 'ann')!.permissionHistory.length, 1);

// no change means no write
assert.equal((await call(BOSS, ['payroll.view'])).json.changed, false);

// HR can grant what HR holds, but not what HR lacks
assert.equal((await call(HR, ['payroll.view', 'leave.manage'])).status, 200);
assert.equal((await call(HR, ['payroll.view', 'leave.manage', 'payroll.manage'])).status, 403, 'cannot escalate');
// unknown permission
assert.equal((await call(BOSS, ['nonsense'])).status, 400);
// nobody edits their own, and an admin has nothing to add
assert.equal((await call(HR, ['payroll.view'], 'hr')).status, 403, 'not yourself');
assert.equal((await call(HR, ['payroll.view'], 'boss')).status, 400);

// HR cannot strip an extra it does not hold; the admin can
await call(BOSS, ['payroll.view', 'leave.manage', 'payroll.manage']);
assert.equal((await call(HR, ['payroll.view', 'leave.manage'])).status, 403, 'cannot remove what you do not hold');
assert.equal((await call(BOSS, [])).status, 200);
assert.deepEqual(users.get('ann')!.claims.perms, ['doc.acknowledge'], 'role permissions stay when extras go');

// a role change keeps the extras
await call(BOSS, ['payroll.view']);
const sr: any = await routeTenant({ method: 'POST', action: 'save-role', headers: BOSS, body: { roleId: 'c1_employee', name: 'employee', permissions: ['doc.acknowledge', 'doc.suggest'], portal: 'EMPLOYEE' }, origin: 'https://x' });
assert.equal(sr.status, 200, JSON.stringify(sr.json));
assert.ok(users.get('ann')!.claims.perms.includes('payroll.view'), 'extras survive a role edit');
assert.ok(users.get('ann')!.claims.perms.includes('doc.suggest'));

console.log('tenant extra permissions tests passed');
