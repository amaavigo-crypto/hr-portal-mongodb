import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';
import { ALL_MODULE_KEYS } from '../shared/permissions.ts';

// Adding organisations to an account (limit, copying settings) and account-level plan, modules and limits.

const fdb = new FakeFirestore();
const claims = new Map<string, any>();
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64');
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: claims.get(uid) || {} }),
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map(({ uid }) => ({ uid, customClaims: claims.get(uid) || {} })) }),
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { claims.set(uid, c); },
    revokeRefreshTokens: async () => undefined,
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';
const tokenFor = (uid: string) => ({ authorization: `Bearer ${b64({ uid, email: `${uid}@x.com`, ...(claims.get(uid) || {}) })}` });
const PA = { authorization: `Bearer ${b64({ uid: 'platform', email: 'p@x.com', pa: true })}` };
const call = (action: string, headers: any, body: any = {}, method = 'POST') => routeTenant({ method, action, headers, body, origin: 'https://app.example' } as any);
const [M1, M2] = ALL_MODULE_KEYS;

fdb.seed('accounts', 'acc1', { id: 'acc1', name: 'Group', ownerEmail: 'g@x.com', orgLimit: 1, groupAdminUids: ['g'], createdAt: 't', updatedAt: 't' });
fdb.seed('accounts', 'acc2', { id: 'acc2', name: 'Other', ownerEmail: 'o@x.com', orgLimit: 1, groupAdminUids: [], createdAt: 't', updatedAt: 't' });
fdb.seed('companies', 'A', { id: 'A', name: 'Alpha Ltd', status: 'ACTIVE', modules: [M1], plan: 'trial', accountId: 'acc1', adminEmail: 'a@x.com', employeeIdPrefix: 'AL', nextEmployeeNumber: 2 });
fdb.seed('companies', 'C', { id: 'C', name: 'Gamma Ltd', status: 'ACTIVE', modules: [M1], plan: 'trial', accountId: 'acc2', adminEmail: 'c@x.com', employeeIdPrefix: 'GA', nextEmployeeNumber: 2 });
fdb.seed('roles', 'A_employee', { id: 'A_employee', companyId: 'A', name: 'Employee', permissions: [], portal: 'EMPLOYEE', isAdmin: false, isDefault: true });
fdb.seed('roles', 'A_custom1', { id: 'A_custom1', companyId: 'A', name: 'Floor Lead', permissions: [], portal: 'EMPLOYEE', isAdmin: false, isDefault: false });
fdb.seed('departments', 'dA1', { id: 'dA1', companyId: 'A', name: 'Operations', headUserId: 'someone' });
fdb.seed('departments', 'dA2', { id: 'dA2', companyId: 'A', name: 'Finance', headUserId: '' });
fdb.seed('leaveSettings', 'A', { companyId: 'A', yearStartMonth: 4, types: [{ id: 'cl', name: 'Casual Leave' }], locations: [], policies: [] });
fdb.seed('employees', 'g', { id: 'g', authUid: 'g', companyId: 'A', companyName: 'Alpha Ltd', email: 'g@x.com', name: 'Gita Group', roleIds: ['A_employee'], active: true });
fdb.seed('employees', 'staff', { id: 'staff', authUid: 'staff', companyId: 'A', companyName: 'Alpha Ltd', email: 'staff@x.com', name: 'Sam Staff', roleIds: ['A_employee'], active: true });
claims.set('g', { cid: 'A', cs: 'ACTIVE', perms: [], adm: true, aid: 'acc1', ga: true, hid: 'A' });
claims.set('staff', { cid: 'A', cs: 'ACTIVE', perms: [], adm: false });
const orgs = (acc: string) => fdb.all('companies').filter((c: any) => c.accountId === acc);

// ---------------------------------------------------------------- who and how many
assert.equal((await call('create-organisation', tokenFor('staff'), { name: 'New Co' })).status, 403, 'group administrators only');
const full = await call('create-organisation', tokenFor('g'), { name: 'Beta Ltd' });
assert.equal(full.status, 403, 'the plan allows one organisation');
assert.match(full.json.error, /allows 1 organisation/);

// platform admin raises the limit (validated)
assert.equal((await call('update-account', tokenFor('g'), { accountId: 'acc1', orgLimit: 3 })).status, 403, 'platform admins only');
assert.equal((await call('update-account', PA, { accountId: 'acc1', orgLimit: 0 })).status, 400);
assert.equal((await call('update-account', PA, { accountId: 'acc1', orgLimit: 1.5 })).status, 400);
assert.equal((await call('update-account', PA, { accountId: 'nope', orgLimit: 3 })).status, 404);
assert.equal((await call('update-account', PA, { accountId: 'acc1', orgLimit: 3 })).status, 200);
assert.equal(fdb.all('accounts').find((a: any) => a.id === 'acc1')!.orgLimit, 3);

// ---------------------------------------------------------------- creating, with nothing copied
assert.equal((await call('create-organisation', tokenFor('g'), { name: 'B' })).status, 400, 'name too short');
assert.equal((await call('create-organisation', tokenFor('g'), { name: 'alpha ltd' })).status, 409, 'name already used in this account');
assert.equal((await call('create-organisation', tokenFor('g'), { name: 'Beta Ltd', cloneFromCompanyId: 'C' })).status, 400, 'cannot copy from another account');
const plain = await call('create-organisation', tokenFor('g'), { name: 'Beta Ltd' });
assert.equal(plain.status, 200, JSON.stringify(plain.json));
const beta = orgs('acc1').find((c: any) => c.name === 'Beta Ltd')!;
assert.equal(beta.status, 'ACTIVE'); assert.equal(beta.accountId, 'acc1'); assert.equal(beta.nextEmployeeNumber, 1);
assert.deepEqual(beta.modules, [M1], 'modules follow the organisation it was created from when the account sets none');
assert.ok(beta.employeeIdPrefix.length >= 2);
const betaRoles = fdb.all('roles').filter((r: any) => r.companyId === beta.id);
assert.ok(betaRoles.some((r: any) => r.isAdmin) && betaRoles.some((r: any) => r.id === `${beta.id}_employee`), 'the standard roles are set up');
assert.ok(!betaRoles.some((r: any) => r.name === 'Floor Lead'), 'custom roles are not copied unless asked');
assert.equal(fdb.all('departments').filter((d: any) => d.companyId === beta.id).length, 0);
assert.equal(fdb.all('leaveSettings').filter((l: any) => l.id === beta.id).length, 0);
assert.equal(orgs('acc2').length, 1, 'the other account is untouched');

// ---------------------------------------------------------------- creating with copies
const gamma = await call('create-organisation', tokenFor('g'), { name: 'Delta Ltd', cloneFromCompanyId: 'A', clone: { departments: true, roles: true, leaveSettings: true } });
assert.equal(gamma.status, 200, JSON.stringify(gamma.json));
assert.deepEqual(gamma.json.copied, ['2 departments', '1 custom role', 'leave settings']);
const delta = orgs('acc1').find((c: any) => c.name === 'Delta Ltd')!;
const deltaDepts = fdb.all('departments').filter((d: any) => d.companyId === delta.id);
assert.deepEqual(deltaDepts.map((d: any) => d.name).sort(), ['Finance', 'Operations']);
assert.ok(deltaDepts.every((d: any) => !d.headUserId), 'department heads are not copied (people are not copied)');
assert.ok(fdb.all('roles').find((r: any) => r.companyId === delta.id && r.name === 'Floor Lead'));
const deltaLeave = fdb.all('leaveSettings').find((l: any) => l.id === delta.id)!;
assert.equal(deltaLeave.companyId, delta.id); assert.equal(deltaLeave.types[0].name, 'Casual Leave');
assert.equal(fdb.all('departments').filter((d: any) => d.companyId === 'A').length, 2, 'the source is untouched');

// the limit now stops a fourth
assert.equal((await call('create-organisation', tokenFor('g'), { name: 'Epsilon Ltd' })).status, 403);
assert.equal((await call('update-account', PA, { accountId: 'acc1', orgLimit: 2 })).status, 400, 'cannot go below the number already in use');

// the group admin can switch into a new organisation
const sw = await call('switch-organisation', tokenFor('g'), { companyId: delta.id });
assert.equal(sw.status, 200); assert.equal(claims.get('g').cid, delta.id);

// ---------------------------------------------------------------- account-level plan and modules reach every organisation
const upd = await call('update-account', PA, { accountId: 'acc1', modules: [M1, M2], plan: 'business' });
assert.equal(upd.status, 200, JSON.stringify(upd.json));
for (const o of orgs('acc1')) { assert.deepEqual(o.modules, [M1, M2], `${o.name} modules`); assert.equal(o.plan, 'business'); }
assert.deepEqual(orgs('acc2')[0].modules, [M1], 'other accounts are untouched');
assert.deepEqual(fdb.all('accounts').find((a: any) => a.id === 'acc1')!.modules, [M1, M2]);
assert.equal(upd.json.usersUpdated, 2, 'everyone in the account\'s organisations gets fresh claims (the two employees of Alpha)');
assert.equal(claims.get('g').cid, 'A', 'a group admin who had switched is returned to their home organisation');
assert.equal((await call('update-account', PA, { accountId: 'acc1', modules: ['not-a-module'] })).status, 400);

// new organisations then follow the account's modules and plan
await call('update-account', PA, { accountId: 'acc1', orgLimit: 5 });
const later = await call('create-organisation', tokenFor('g'), { name: 'Zeta Ltd', cloneFromCompanyId: 'A' });
assert.equal(later.status, 200);
const zeta = orgs('acc1').find((c: any) => c.name === 'Zeta Ltd')!;
assert.deepEqual(zeta.modules, [M1, M2]); assert.equal(zeta.plan, 'business');

// ---------------------------------------------------------------- listings
const accts = await call('accounts', PA, {}, 'GET');
assert.equal(accts.status, 200);
assert.equal(accts.json.accounts.find((a: any) => a.id === 'acc1').organisations, 4);
assert.equal(accts.json.accounts.find((a: any) => a.id === 'acc2').organisations, 1);
assert.equal((await call('accounts', tokenFor('g'), {}, 'GET')).status, 403);
const mine = await call('my-organisations', tokenFor('g'), {}, 'GET');
assert.equal(mine.json.organisations.length, 4);
assert.equal(mine.json.account.orgLimit, 5);
assert.deepEqual(mine.json.groupAdmins.map((g: any) => g.email), ['g@x.com']);

console.log('org create: ok');
