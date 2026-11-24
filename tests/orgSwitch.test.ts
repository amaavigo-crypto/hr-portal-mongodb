import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';

// Group administrators: add/remove, list the account's organisations, switch between them. Every step is checked on the server.

const fdb = new FakeFirestore();
const claims = new Map<string, any>();
const revoked: string[] = [];
let n = 0;
const emails = new Map<string, string>();
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64');
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: claims.get(uid) || {} }),
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map(({ uid }) => ({ uid, customClaims: claims.get(uid) || {} })) }),
    getUserByEmail: async (email: string) => { if (!emails.has(email)) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); return { uid: emails.get(email) }; },
    createUser: async (p: any) => { const uid = `new_${++n}`; emails.set(p.email, uid); return { uid }; },
    deleteUser: async () => undefined,
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { claims.set(uid, c); },
    revokeRefreshTokens: async (uid: string) => { revoked.push(uid); },
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

// the token a person would hold right now: their server-written claims plus identity
const tokenFor = (uid: string, email = `${uid}@x.com`) => ({ authorization: `Bearer ${b64({ uid, email, ...(claims.get(uid) || {}) })}` });
const PA = { authorization: `Bearer ${b64({ uid: 'platform', email: 'p@x.com', pa: true })}` };
const call = (method: string, action: string, headers: any, body: any = {}) => routeTenant({ method, action, headers, body, origin: 'https://app.example' } as any);

// ---- data: account 1 has organisations A (home of the group admin) and B; account 2 has C
const seedOrg = (id: string, name: string, accountId: string, status = 'ACTIVE') => {
  fdb.seed('companies', id, { id, name, status, modules: ['talent-acquisition'], accountId, adminEmail: `${id}@x.com`, employeeIdPrefix: id.toUpperCase().slice(0, 2), nextEmployeeNumber: 5 });
  fdb.seed('roles', `${id}_employee`, { id: `${id}_employee`, companyId: id, name: 'Employee', permissions: [], portal: 'EMPLOYEE', isAdmin: false });
  fdb.seed('roles', `${id}_admin`, { id: `${id}_admin`, companyId: id, name: 'Admin', permissions: [], portal: 'CREATOR', isAdmin: true });
};
fdb.seed('accounts', 'acc1', { id: 'acc1', name: 'Group One', ownerEmail: 'g@x.com', orgLimit: 5, groupAdminUids: [], createdAt: 't', updatedAt: 't' });
fdb.seed('accounts', 'acc2', { id: 'acc2', name: 'Group Two', ownerEmail: 'z@x.com', orgLimit: 1, groupAdminUids: [], createdAt: 't', updatedAt: 't' });
seedOrg('A', 'Alpha Ltd', 'acc1');
seedOrg('B', 'Beta Ltd', 'acc1');
seedOrg('S', 'Sleepy Ltd', 'acc1', 'SUSPENDED');
seedOrg('C', 'Gamma Ltd', 'acc2');
const emp = (uid: string, companyId: string, roleIds: string[] = [`${companyId}_employee`]) =>
  fdb.seed('employees', uid, { id: uid, authUid: uid, companyId, companyName: companyId, email: `${uid}@x.com`, name: uid, roleIds, active: true, empId: `${companyId}-${uid}` });
emp('g', 'A');            // will become a group admin; an ordinary employee of A
emp('g2', 'B');           // a second candidate, employee of B
emp('plain', 'A');
emp('outsider', 'C');
for (const u of ['g', 'g2', 'plain', 'outsider']) claims.set(u, { cid: u === 'outsider' ? 'C' : u === 'g2' ? 'B' : 'A', cs: 'ACTIVE', perms: [], adm: false });

// ---- not a group admin yet
assert.equal((await call('GET', 'my-organisations', tokenFor('g'))).status, 403);
assert.equal((await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'B' })).status, 403);

// ---- only platform admins (or an existing group admin of that account) can add one
assert.equal((await call('POST', 'set-group-admin', tokenFor('plain'), { email: 'g@x.com' })).status, 403);
assert.equal((await call('POST', 'set-group-admin', PA, { accountId: 'acc1', email: 'nobody@x.com' })).status, 404);
assert.equal((await call('POST', 'set-group-admin', PA, { accountId: 'acc1', email: 'outsider@x.com' })).status, 404, 'an employee of another account cannot be made a group admin here');
const added = await call('POST', 'set-group-admin', PA, { accountId: 'acc1', email: 'g@x.com' });
assert.equal(added.status, 200, JSON.stringify(added.json));
assert.deepEqual(fdb.all('accounts').find((a: any) => a.id === 'acc1')!.groupAdminUids, ['g']);

// their claims now say so, and they are admin in their own organisation
const gc = claims.get('g');
assert.equal(gc.ga, true); assert.equal(gc.aid, 'acc1'); assert.equal(gc.hid, 'A'); assert.equal(gc.cid, 'A'); assert.equal(gc.adm, true);
assert.equal(claims.get('plain').ga, undefined, 'other people are untouched');

// ---- list organisations: only this account's
const list = await call('GET', 'my-organisations', tokenFor('g'));
assert.equal(list.status, 200);
assert.deepEqual(list.json.organisations.map((o: any) => o.id).sort(), ['A', 'B', 'S']);
assert.equal(list.json.organisations.find((o: any) => o.id === 'A').home, true);
assert.equal(list.json.organisations.find((o: any) => o.id === 'A').current, true);

// ---- switch rules
assert.equal((await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'C' })).status, 403, 'another account\'s organisation');
assert.equal((await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'nope' })).status, 404);
assert.equal((await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'S' })).status, 400, 'suspended organisation');
assert.equal(claims.get('g').cid, 'A', 'refused switches change nothing');

const sw = await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'B' });
assert.equal(sw.status, 200, JSON.stringify(sw.json));
const sc = claims.get('g');
assert.equal(sc.cid, 'B'); assert.equal(sc.adm, true); assert.equal(sc.aid, 'acc1'); assert.equal(sc.hid, 'A'); assert.equal(sc.ga, true);
assert.equal((await call('GET', 'my-organisations', tokenFor('g'))).json.organisations.find((o: any) => o.id === 'B').current, true);

// while switched they act as administrator inside B (and only B)
const made = await call('POST', 'create-user', tokenFor('g'), { name: 'Bela Beta', email: 'bela@b.com', sendInvite: false });
assert.equal(made.status, 200, JSON.stringify(made.json));
assert.equal(fdb.all('employees').find((e: any) => e.email === 'bela@b.com')!.companyId, 'B');

// switching back to the home organisation restores the normal claims
const back = await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'A' });
assert.equal(back.status, 200); assert.equal(back.json.home, true);
assert.equal(claims.get('g').cid, 'A'); assert.equal(claims.get('g').hid, 'A');

// every switch is on the record
const trail = fdb.all('accountAudit').filter((a: any) => a.action === 'SWITCH_ORG');
assert.equal(trail.length, 2);
assert.deepEqual([trail[0].from, trail[0].to, trail[0].by], ['A', 'B', 'g']);

// ---- a group admin can add a colleague of their own account, but not for another account
const second = await call('POST', 'set-group-admin', tokenFor('g'), { email: 'g2@x.com' });
assert.equal(second.status, 200);
assert.deepEqual(fdb.all('accounts').find((a: any) => a.id === 'acc1')!.groupAdminUids.sort(), ['g', 'g2']);
assert.equal((await call('POST', 'set-group-admin', tokenFor('g'), { email: 'outsider@x.com' })).status, 404);
assert.equal(fdb.all('accounts').find((a: any) => a.id === 'acc2')!.groupAdminUids.length, 0);

// ---- removing: the last one cannot be removed by a group admin; once removed, old tokens stop working
await call('POST', 'switch-organisation', tokenFor('g'), { companyId: 'B' });
const oldToken = tokenFor('g'); // still carries ga + cid B
assert.equal((await call('POST', 'set-group-admin', tokenFor('g2'), { email: 'g@x.com', enabled: false })).status, 200);
assert.equal((await call('POST', 'set-group-admin', tokenFor('g2'), { email: 'g2@x.com', enabled: false })).status, 400, 'an account keeps at least one group admin');
assert.ok(revoked.includes('g'), 'their sessions are revoked');
assert.equal(claims.get('g').ga, undefined, 'claims rebuilt without group admin');
assert.equal(claims.get('g').cid, 'A', 'and they are back in their home organisation');
assert.equal(claims.get('g').adm, false);
assert.equal((await call('GET', 'my-organisations', oldToken)).status, 403, 'a stale token cannot list');
assert.equal((await call('POST', 'switch-organisation', oldToken, { companyId: 'B' })).status, 403, 'a stale token cannot switch');
// a platform admin may remove the last one
assert.equal((await call('POST', 'set-group-admin', PA, { accountId: 'acc1', email: 'g2@x.com', enabled: false })).status, 200);

console.log('org switch: ok');
