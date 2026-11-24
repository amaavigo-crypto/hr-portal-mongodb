import assert from 'node:assert/strict';
import { ensureIndexes } from '../api/_lib/mongoFirestore.ts';
import { MONGO_INDEXES } from '../api/_lib/mongoIndexes.ts';

const made: Record<string, { keys: any; name: string }[]> = {};
const fakeCol = (name: string, failOn?: string) => ({
  createIndex: async (keys: any, opts: any) => {
    if (opts.name === failOn) throw new Error('index exists with different options');
    (made[name] ??= []).push({ keys, name: opts.name });
  },
});

ensureIndexes(fakeCol('leaveRequests') as any, 'leaveRequests');
ensureIndexes(fakeCol('leaveRequests') as any, 'leaveRequests'); // second use: nothing again
ensureIndexes(fakeCol('employees', 'authUid_1') as any, 'employees'); // one failure must not stop the others
ensureIndexes(fakeCol('somethingElse') as any, 'somethingElse');
await new Promise((r) => setTimeout(r, 20));

assert.deepEqual(made.leaveRequests.map((i) => i.name), ['companyId_1', 'companyId_1_status_1', 'companyId_1_uid_1']);
assert.deepEqual(made.leaveRequests[1].keys, { companyId: 1, status: 1 });
assert.deepEqual(made.employees.map((i) => i.name), ['companyId_1', 'companyId_1_departmentId_1', 'companyId_1_email_1', 'companyId_1_roleIds_1']);
assert.deepEqual(made.somethingElse.map((i) => i.name), ['companyId_1'], 'every collection still gets companyId');

// Sanity: every compound index used for per-company data leads with companyId (the rest are global lookups).
const GLOBAL = new Set(['authUid', 'kind', 'token', 'webhookId', 'status']);
for (const [col, list] of Object.entries(MONGO_INDEXES)) for (const keys of list) {
  const first = Object.keys(keys)[0];
  assert.ok(first === 'companyId' || GLOBAL.has(first), `${col}: index ${JSON.stringify(keys)} should start with companyId`);
}
console.log('mongo indexes: all checks passed');
