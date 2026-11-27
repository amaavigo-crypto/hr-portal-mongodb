/** Email from the browser (emailGate.ts) and the audit trail (dataApi.ts) cannot be abused or forged. */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeEmail, __setGateMailer, __clearGateCache, HOURLY_LIMIT } from '../api/_lib/emailGate.ts';
import { routeData } from '../api/_lib/dataApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1', extra: any = {}) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false, ...extra })).toString('base64')}` });
const sent: any[] = [];
__setGateMailer(async (p) => { sent.push(p); return { success: true, provider: 'test' }; });
const mail = (headers: any, action: string, body: any = {}, method = 'POST') => routeEmail({ method, action, body, headers });

async function main() {
  fdb.seed('employees', 'eve', { companyId: 'c1', name: 'Eve', email: 'eve@a.com', role: 'EMPLOYEE', active: true });
  fdb.seed('employees', 'hr', { companyId: 'c1', name: 'Hema', email: 'HR@a.com', role: 'CREATOR', active: true });
  fdb.seed('employees', 'gone', { companyId: 'c1', name: 'Gone', email: 'gone@a.com', active: false });
  fdb.seed('employees', 'x', { companyId: 'c2', name: 'Mallory', email: 'mallory@other.com', active: true });
  __clearGateCache();
  const eve = tok('eve', ['doc.acknowledge']);
  const msg = { to: 'hr@a.com', recipientName: 'Hema', subject: 'Hello\r\nBcc: someone@evil.com', body: 'Hi' };

  assert.equal((await mail({}, 'send', msg)).status, 401);
  assert.equal((await mail(eve, 'send', { ...msg, html: '<a href=x>click</a>', ics: { content: 'x' }, fromName: 'The CEO' })).status, 200);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['body', 'recipientName', 'subject', 'to'], 'no html, invite or sender name from the browser');
  assert.equal(/[\r\n]/.test(sent[0].subject), false);
  // outsiders, other companies, former staff and address lists are refused
  for (const to of ['stranger@evil.com', 'mallory@other.com', 'gone@a.com', 'hr@a.com, stranger@evil.com', '"x" <hr@a.com>']) {
    const r = await mail(eve, 'send', { ...msg, to });
    assert.ok(r.status === 403 || r.status === 400, `${to} refused`);
  }
  assert.equal(sent.length, 1);
  // hourly limit per person
  for (let i = 1; i < HOURLY_LIMIT.member; i++) assert.equal((await mail(eve, 'send', msg)).status, 200);
  assert.equal((await mail(eve, 'send', msg)).status, 429);
  assert.equal((await mail(tok('hr', ['doc.create']), 'send', msg)).status, 200);

  // the test message: admins only, and only to themselves
  assert.equal((await mail(eve, 'test', { to: 'hr@a.com' })).status, 403);
  sent.length = 0;
  assert.equal((await mail(tok('hr', ['users.manage']), 'test', { to: 'stranger@evil.com' })).status, 200);
  assert.equal(sent[0].to, 'hr@a.com');
  process.env.SMTP_USER = 'box@a.com'; process.env.SMTP_PASS = 'x';
  assert.equal((await mail(eve, 'config', {}, 'GET')).json.userEmail, '');
  assert.equal((await mail(tok('hr', ['users.manage']), 'config', {}, 'GET')).json.userEmail, 'box@a.com');

  // ---- audit trail
  const data = (headers: any, action: string, body: any) => routeData({ method: 'POST', action, body, headers });
  const forged = { id: 'l1', action: 'DOCUMENT_PUBLISHED', performedById: 'hr', performedByName: 'Hema', performedByRole: 'CREATOR', performedAt: '2001-01-01T00:00:00Z', ipAddress: '1.1.1.1', actorUid: 'hr' };
  assert.equal((await data({ ...eve, 'x-forwarded-for': '9.9.9.9, 10.0.0.7' }, 'data-set', { collection: 'auditLogs', id: 'l1', data: forged })).status, 200);
  const stored = fdb.all('auditLogs').find((x) => x.id === 'l1')!;
  assert.equal(stored.performedById, 'eve');
  assert.equal(stored.actorUid, 'eve');
  assert.equal(stored.performedByName, 'Eve');
  assert.equal(stored.performedByRole, 'EMPLOYEE');
  assert.equal(stored.ipAddress, '10.0.0.7');
  assert.notEqual(stored.performedAt.slice(0, 4), '2001');
  assert.equal((await data(eve, 'data-set', { collection: 'auditLogs', id: 'l1', data: forged })).status, 403);

  await data(tok('hr', ['doc.create']), 'data-set', { collection: 'auditLogs', id: 'l2', data: { id: 'l2', action: 'VIEW' } });
  const ids = async (h: any) => (await data(h, 'data-list', { collection: 'auditLogs' })).json.docs.map((d: any) => d.id).sort();
  assert.deepEqual(await ids(eve), ['l1'], 'an employee reads only their own entries');
  assert.deepEqual(await ids(tok('a', ['audit.view'])), ['l1', 'l2']);
  assert.deepEqual(await ids(tok('a', [], 'c1', { adm: true })), ['l1', 'l2']);
  assert.deepEqual(await ids(tok('x', ['audit.view'], 'c2')), []);
  assert.equal((await data(eve, 'data-get', { collection: 'auditLogs', id: 'l2' })).json.exists, false);

  console.log('security email and audit tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
