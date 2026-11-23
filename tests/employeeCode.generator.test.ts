import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';

// New people get the next code from the company counter. Codes can be edited by hand, so the counter must skip any code
// that is already taken instead of handing it out twice.

delete process.env.SMTP_USER; delete process.env.SMTP_PASS;

const fdb = new FakeFirestore();
const users = new Map<string, { uid: string; email: string; claims: any }>();
let created = 0;
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, email: users.get(uid)!.email, disabled: false, customClaims: users.get(uid)!.claims, metadata: {} }),
    getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); },
    createUser: async (p: any) => { const uid = `new_${++created}`; users.set(uid, { uid, email: p.email, claims: {} }); return { uid }; },
    deleteUser: async () => undefined,
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { users.get(uid)!.claims = c; },
    revokeRefreshTokens: async () => undefined,
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

fdb.seed('companies', 'c1', { id: 'c1', name: 'Acme', status: 'ACTIVE', modules: [], adminEmail: 'boss@acme.com', employeeIdPrefix: 'AC', nextEmployeeNumber: 9 });
fdb.seed('roles', 'c1_admin', { id: 'c1_admin', companyId: 'c1', name: 'admin', permissions: [], portal: 'CREATOR', isAdmin: true });
fdb.seed('roles', 'c1_employee', { id: 'c1_employee', companyId: 'c1', name: 'employee', permissions: ['doc.acknowledge'], portal: 'EMPLOYEE', isAdmin: false });
users.set('boss', { uid: 'boss', email: 'boss@acme.com', claims: {} });
fdb.seed('employees', 'boss', { id: 'boss', authUid: 'boss', companyId: 'c1', companyName: 'Acme', empId: 'AC001', name: 'Boss', email: 'boss@acme.com', roleIds: ['c1_admin'], perms: [], active: true });
// two codes set by hand, right where the counter is heading (one in lower case, one on an inactive person)
fdb.seed('employees', 'hand1', { id: 'hand1', authUid: 'hand1', companyId: 'c1', empId: 'ac010', name: 'Hand One', email: 'h1@acme.com', roleIds: [], perms: [], active: true });
fdb.seed('employees', 'hand2', { id: 'hand2', authUid: 'hand2', companyId: 'c1', empId: 'AC011', name: 'Hand Two', email: 'h2@acme.com', roleIds: [], perms: [], active: false });
// another company's codes must not matter
fdb.seed('employees', 'other', { id: 'other', authUid: 'other', companyId: 'c2', empId: 'AC012', name: 'Other Co', email: 'o@x.com', roleIds: [], perms: [], active: true });

const BOSS = { authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'boss', email: 'boss@acme.com', cid: 'c1', cs: 'ACTIVE', perms: [], adm: true })).toString('base64')}` };
const add = async (name: string) => {
  const r = await routeTenant({ method: 'POST', action: 'create-user', headers: BOSS, body: { name, email: `${name.toLowerCase()}@acme.com`, sendInvite: false }, origin: 'https://app.example' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.empId as string;
};

assert.equal(await add('Ann'), 'AC009', 'the counter gives the next free code');
assert.equal(await add('Bob'), 'AC012', 'AC010 and AC011 are held by hand-set codes, so they are skipped (another company\'s AC012 does not count)');
assert.equal(await add('Cat'), 'AC013');
assert.equal(fdb.all('companies').find((c: any) => c.id === 'c1')!.nextEmployeeNumber, 14, 'the counter moves past what was handed out');
const codes = fdb.all('employees').filter((e: any) => e.companyId === 'c1').map((e: any) => String(e.empId).toUpperCase());
assert.equal(new Set(codes).size, codes.length, 'no code is used twice in the company');

console.log('employee code generator: ok');
