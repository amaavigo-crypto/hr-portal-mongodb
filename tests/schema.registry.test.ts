/** The database schemas (api/_lib/schemas): every collection the code uses has one, writes are checked, modes work. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoFirestore, MongoFieldValues as FV } from '../api/_lib/mongoFirestore.ts';
import { SCHEMAS, validateDoc, indexesFor, HIRING_KINDS, HRBP_KINDS } from '../api/_lib/schemas/index.ts';
import { StubMongoDb } from './mongoStub.ts';

async function main() {
  // 1. Coverage: every collection named in api/ or server.ts has a schema
  const used = new Set<string>();
  const scan = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) scan(p);
      else if (f.name.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/collection\('([A-Za-z]+)'\)/g)) used.add(m[1]);
    }
  };
  scan('api');
  const missing = [...used].filter((n) => !SCHEMAS[n] && n !== 'things');
  assert.deepEqual(missing, [], `collections without a schema: ${missing.join(', ')}`);
  assert.ok(Object.keys(SCHEMAS).length >= 123);

  // 2. Valid documents pass
  const company = { id: 'cmp_1', name: 'Acme', slug: 'acme', status: 'ACTIVE', modules: ['talent-acquisition'], plan: 'trial', adminEmail: 'a@acme.com', employeeIdPrefix: 'ACM', nextEmployeeNumber: 2, createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z' };
  assert.deepEqual(await validateDoc('companies', company, 'full'), []);
  const employee = { id: 'u1', authUid: 'u1', companyId: 'cmp_1', name: 'Asha', email: 'asha@acme.com', roleIds: ['r1'], role: 'EMPLOYEE', perms: [], authorizedModules: 'ALL', active: true, customField: 'kept' };
  assert.deepEqual(await validateDoc('employees', employee, 'full'), [], 'unlisted fields are allowed');
  assert.deepEqual(await validateDoc('employees', { ...employee, authorizedModules: ['x', 'y'] }, 'full'), [], 'authorizedModules is a string or a list');

  // 3. Problems are found: missing required field, wrong enum, wrong type
  const bad = await validateDoc('employees', { id: 'u2', name: 'No company', email: 'x@y.z', active: true, role: 'BOSS' }, 'full');
  assert.deepEqual(bad.map((p) => p.path).sort(), ['companyId', 'role']);
  assert.ok((await validateDoc('leaveLedger', { companyId: 'c', uid: 'u', typeId: 't', delta: 'abc', kind: 'USED' }, 'full')).some((p) => p.path === 'delta'));
  assert.deepEqual(await validateDoc('leaveLedger', { companyId: 'c', uid: 'u', typeId: 't', delta: -1, kind: 'USED', cycle: '2026' }, 'full'), []);

  // 4. Partial writes only check the fields that are present; dotted keys and sentinels are skipped
  assert.deepEqual(await validateDoc('employees', { title: 'Lead' }, 'partial'), []);
  assert.ok((await validateDoc('employees', { role: 'BOSS' }, 'partial')).length === 1);
  assert.deepEqual(await validateDoc('payrollRuns', { 'totals.net': 5, status: 'PAID' }, 'partial'), []);
  assert.deepEqual(await validateDoc('leaveLedger', { delta: FV.increment(1) }, 'partial'), []);

  // 5. Mixed collections: base rules plus kind-specific rules
  assert.deepEqual(await validateDoc('hiringItems', { id: 'i1', companyId: 'c', kind: 'posting', anything: 1 }, 'full'), []);
  assert.ok((await validateDoc('hiringItems', { id: 'i1', companyId: 'c' }, 'full')).some((p) => p.path === 'kind'));
  assert.ok((await validateDoc('hiringItems', { id: 'r', companyId: 'c', kind: 'flowRun', applicationId: 'a', status: 'DANCING' }, 'full')).some((p) => p.path === 'status'));
  assert.deepEqual(await validateDoc('hiringItems', { id: 'r', companyId: 'c', kind: 'flowRun', applicationId: 'a', status: 'RUNNING' }, 'full'), []);
  assert.ok(HIRING_KINDS.includes('flowRun') && HRBP_KINDS.includes('pip'));

  // 5b. Account-level collections have no companyId and get no companyId index
  assert.deepEqual(await validateDoc('accounts', { id: 'acc_c', name: 'Acme Group', orgLimit: 3, groupAdminUids: ['u1'] }, 'full'), []);
  assert.ok((await validateDoc('accounts', { id: 'acc_c', name: 'No limit' }, 'full')).some((p) => p.path === 'orgLimit'));
  assert.ok(!indexesFor('accounts').some(([f]) => 'companyId' in f));
  assert.ok(indexesFor('employmentHistory').some(([f]) => 'uid' in f));

  // 6. Unknown collections are never blocked
  assert.deepEqual(await validateDoc('things', { whatever: true }, 'full'), []);

  // 7. Indexes: companyId first, nothing unique
  const idx = indexesFor('employees');
  assert.deepEqual(idx[0][0], { companyId: 1 });
  assert.ok(idx.some(([f]) => 'email' in f && 'companyId' in f));
  assert.ok(idx.every(([, o]) => !(o as any)?.unique));
  assert.deepEqual(indexesFor('nothing'), [[{ companyId: 1 }, { name: 'companyId_1' }]]);

  // 8. Through the adapter: warn mode saves, enforce mode refuses, off mode ignores
  const db = new MongoFirestore(new StubMongoDb() as any);
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
  try {
    delete process.env.SCHEMA_VALIDATION;
    await db.collection('employees').doc('w1').set({ id: 'w1', name: 'Warned', email: 'w@x.y', active: true, role: 'BOSS' });
    assert.equal((await db.collection('employees').doc('w1').get()).exists, true, 'warn mode still saves');
    assert.ok(warns.some((w) => w.includes('[schema] employees/w1') && w.includes('companyId')));
    const before = warns.length;
    await db.collection('employees').doc('w2').set({ id: 'w2', name: 'Again', email: 'w@x.y', active: true });
    assert.equal(warns.length, before, 'the same problem is reported once');

    process.env.SCHEMA_VALIDATION = 'enforce';
    await assert.rejects(() => db.collection('employees').doc('e1').set({ id: 'e1', name: 'Nope', email: 'n@x.y', active: true }), /Schema check failed for employees\/e1/);
    assert.equal((await db.collection('employees').doc('e1').get()).exists, false, 'enforce mode does not save');
    await db.collection('employees').doc('ok1').set({ ...employee, id: 'ok1' });
    await db.collection('employees').doc('ok1').update({ title: 'Lead', loginCount: FV.increment(1) });
    await assert.rejects(() => db.collection('employees').doc('ok1').update({ role: 'BOSS' }), /SCHEMA_INVALID|Schema check failed/);
    await db.collection('employees').doc('ok1').set({ title: 'Head' }, { merge: true });
    assert.equal((await db.collection('employees').doc('ok1').get()).get('title'), 'Head');
    await assert.rejects(() => db.collection('employees').doc('c1').create({ name: 'X', email: 'x@y.z', active: true }), /Schema check failed/);

    process.env.SCHEMA_VALIDATION = 'off';
    await db.collection('employees').doc('off1').set({ junk: true });
    assert.equal((await db.collection('employees').doc('off1').get()).exists, true);
  } finally {
    console.warn = realWarn;
    delete process.env.SCHEMA_VALIDATION;
  }

  console.log('schema registry tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
