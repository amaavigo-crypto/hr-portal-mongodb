import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';
import { accountIdFor, backfillAccounts, ensureAccount, releaseAccountIfEmpty } from '../api/_lib/accounts.ts';

// Every organisation (company) belongs to an account. Stage 1: accounts are created and linked, nothing else changes.

const fdb = new FakeFirestore();
const claims = new Map<string, any>();
const users = new Map<string, any>();
let n = 0;
const tokenOf = (uid: string, pa = false) => Buffer.from(JSON.stringify({ uid, email: `${uid}@x.com`, pa })).toString('base64');
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: claims.get(uid) || {} }),
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map(({ uid }) => ({ uid, customClaims: claims.get(uid) || {} })) }),
    getUserByEmail: async (email: string) => { const u = users.get(email); if (!u) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); return u; },
    createUser: async (p: any) => { const uid = `new_${++n}`; users.set(p.email, { uid, email: p.email }); return { uid }; },
    deleteUser: async () => undefined,
    deleteUsers: async (uids: string[]) => ({ failureCount: 0, successCount: uids.length, errors: [] }),
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { claims.set(uid, c); },
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

const PA = { authorization: `Bearer ${tokenOf('platform', true)}` };
const NOT_PA = { authorization: `Bearer ${tokenOf('someone')}` };
const accounts = () => fdb.all('accounts');

// ---- a new signup gets its own account, linked from the company
const s = await routeTenant({ method: 'POST', action: 'signup', headers: {}, body: { companyName: 'Fresh Ltd', adminName: 'Fay Founder', email: 'fay@fresh.com', password: 'longenough1' }, origin: 'https://app.example' });
assert.equal(s.status, 200, JSON.stringify(s.json));
const fresh = fdb.all('companies').find((c: any) => c.id === s.json.companyId)!;
assert.equal(fresh.accountId, accountIdFor(fresh.id));
const acct = accounts().find((a: any) => a.id === fresh.accountId)!;
assert.ok(acct, 'the account exists');
assert.equal(acct.name, 'Fresh Ltd');
assert.equal(acct.ownerEmail, 'fay@fresh.com');
assert.equal(acct.orgLimit, 1);

// a refused signup (email already used) leaves no account behind
const before = accounts().length;
const dupe = await routeTenant({ method: 'POST', action: 'signup', headers: {}, body: { companyName: 'Other Ltd', adminName: 'Fay Again', email: 'fay@fresh.com', password: 'longenough1' }, origin: 'https://app.example' });
assert.equal(dupe.status, 409);
assert.equal(accounts().length, before);

// ---- existing companies (made before accounts existed) are given one by the backfill
fdb.seed('companies', 'cmp_old1', { id: 'cmp_old1', name: 'Old One', status: 'ACTIVE', modules: ['talent-acquisition'], adminEmail: 'Boss@Old1.com', employeeIdPrefix: 'OA', nextEmployeeNumber: 4 });
fdb.seed('companies', 'cmp_old2', { id: 'cmp_old2', name: 'Old Two', status: 'ACTIVE', modules: [], adminEmail: 'boss@old2.com' });
fdb.seed('employees', 'old_emp', { id: 'old_emp', authUid: 'old_emp', companyId: 'cmp_old1', empId: 'OA001', active: true });

assert.equal((await routeTenant({ method: 'POST', action: 'backfill-accounts', headers: NOT_PA, body: {} })).status, 403, 'only platform admins');
const run1 = await routeTenant({ method: 'POST', action: 'backfill-accounts', headers: PA, body: {} });
assert.equal(run1.status, 200);
assert.equal(run1.json.created, 2, 'two old companies got an account (Fresh already had one)');
assert.equal(run1.json.linked, 2);
const old1 = fdb.all('companies').find((c: any) => c.id === 'cmp_old1')!;
assert.equal(old1.accountId, 'acc_cmp_old1');
assert.equal(accounts().find((a: any) => a.id === 'acc_cmp_old1')!.ownerEmail, 'boss@old1.com', 'owner email is lower-cased');

// nothing else on the company or its people was touched
assert.equal(old1.employeeIdPrefix, 'OA');
assert.equal(old1.nextEmployeeNumber, 4);
assert.deepEqual(old1.modules, ['talent-acquisition']);
assert.equal(fdb.all('employees').find((e: any) => e.id === 'old_emp')!.empId, 'OA001');

// running it again changes nothing
const total = accounts().length;
const run2 = await routeTenant({ method: 'POST', action: 'backfill-accounts', headers: PA, body: {} });
assert.equal(run2.json.created, 0);
assert.equal(run2.json.linked, 0);
assert.equal(accounts().length, total);

// a company that points at an account which has gone missing gets it recreated, with the same id
fdb.seed('companies', 'cmp_lost', { id: 'cmp_lost', name: 'Lost Co', status: 'ACTIVE', adminEmail: 'x@lost.com', accountId: 'acc_custom' });
const fixed = await ensureAccount(fdb as any, { id: 'cmp_lost', name: 'Lost Co', adminEmail: 'x@lost.com', accountId: 'acc_custom' });
assert.equal(fixed.accountId, 'acc_custom');
assert.equal(fixed.created, true);
assert.equal(fixed.linked, false, 'the company already pointed at it');

// ---- deleting a company removes its account only when no other organisation still uses it
fdb.seed('companies', 'cmp_org2', { id: 'cmp_org2', name: 'Old One North', status: 'ACTIVE', adminEmail: 'n@old1.com', accountId: 'acc_cmp_old1' });
assert.equal(await releaseAccountIfEmpty(fdb as any, 'acc_cmp_old1'), false, 'another organisation still belongs to it');
assert.ok(accounts().find((a: any) => a.id === 'acc_cmp_old1'));

const del = await routeTenant({ method: 'POST', action: 'delete-company', headers: PA, body: { companyId: 'cmp_old2', confirmName: 'Old Two' } });
assert.equal(del.status, 200, JSON.stringify(del.json));
assert.equal(del.json.accountRemoved, true);
assert.ok(!accounts().find((a: any) => a.id === 'acc_cmp_old2'), 'its account went with it');
assert.ok(accounts().find((a: any) => a.id === 'acc_cmp_old1'), 'other accounts are untouched');

assert.equal(await releaseAccountIfEmpty(fdb as any, undefined), false);
assert.deepEqual(await backfillAccounts(fdb as any).then((r) => r.created), 0);

console.log('accounts: ok');
