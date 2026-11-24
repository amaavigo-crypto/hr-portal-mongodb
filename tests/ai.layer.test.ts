import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { aiJson, aiText, aiUsage, s, validate, modelFor } from '../api/_lib/ai/index.ts';
import { costMicros } from '../api/_lib/ai/pricing.ts';

// ---- validator
const sch = s.obj({ score: s.num(0, 100), tags: s.arr(s.str(10), 2), note: s.optional(s.str(5), 'none'), ok: s.bool() });
const good = validate(sch, { score: '150', tags: ['aaaaaaaaaaaaaaa', 'b', 'c'], ok: 'true', extra: 1 });
assert.equal(good.ok, true);
assert.deepEqual((good as any).value, { score: 100, tags: ['aaaaaaaaaa', 'b'], note: 'none', ok: true }, 'clamped, shortened, defaults filled, unknown keys dropped');
assert.equal(validate(sch, { score: 'x', tags: [], ok: true }).ok, false);
assert.equal(validate(sch, { tags: [], ok: true }).ok, false, 'missing required field');

// ---- pricing and model choice
assert.equal(costMicros('gpt-4o-mini', 1_000_000, 1_000_000), 750_000);
assert.equal(costMicros('gpt-4o-mini-2024-07-18', 1000, 0), 150);
assert.equal(costMicros('some-new-model', 1000, 1000), 0);
process.env.AI_MODEL = 'm-default';
assert.equal(modelFor('hiring.resume'), 'm-default');
process.env.OPENAI_SCORING_MODEL = 'm-old-scoring';
assert.equal(modelFor('scoring'), 'm-old-scoring', 'older env names still work');
process.env.AI_MODEL_SCORING = 'm-new-scoring';
assert.equal(modelFor('scoring'), 'm-new-scoring', 'new per-feature setting wins');
delete process.env.AI_MODEL_SCORING; delete process.env.OPENAI_SCORING_MODEL; delete process.env.AI_MODEL;

// ---- fake provider
const db = new FakeFirestore();
__useFakeAdmin({ db, auth: { verifyIdToken: async () => ({}) } });
let calls: any[] = [];
let script: Array<{ status: number; content?: string }> = [];
(globalThis as any).fetch = async (_u: string, init: any) => {
  calls.push(JSON.parse(init.body));
  const step = script.shift() || { status: 200, content: '{}' };
  const body = step.status === 200
    ? { choices: [{ message: { content: step.content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }
    : { error: { message: 'busy' } };
  return { ok: step.status === 200, status: step.status, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any;
};

(async () => {
  // off without a key
  delete process.env.OPENAI_API_KEY;
  assert.equal((await aiJson({ cid: 'c1', feature: 'x', system: 's', user: 'u' })).off, true);
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.AI_MONTHLY_CALLS = '3';

  // success is recorded with tokens and cost
  script = [{ status: 200, content: '{"score":5,"tags":["a"],"ok":true}' }];
  let r = await aiJson({ cid: 'c1', feature: 'claims.scan', system: 's', user: 'u', schema: sch });
  assert.deepEqual(r.data, { score: 5, tags: ['a'], note: 'none', ok: true });
  let u = await aiUsage('c1');
  assert.equal(u.used, 1);
  assert.equal(u.inputTokens, 1000);
  assert.equal(u.byFeature['claims.scan'].calls, 1);
  assert.equal(u.costMicros, costMicros('gpt-4o-mini', 1000, 500));
  assert.equal(db.all('aiUsageLog').length, 1, 'one log row per provider call');

  // a busy service is retried, and the call still counts once
  script = [{ status: 503 }, { status: 200, content: '{"score":1,"tags":[],"ok":false}' }];
  r = await aiJson({ cid: 'c1', feature: 'x', system: 's', user: 'u', schema: sch });
  assert.equal(r.data?.score, 1);
  assert.equal((await aiUsage('c1')).used, 2, 'retry is not a second call');

  // a bad request is not retried, and the reserved call is given back
  calls = [];
  script = [{ status: 400 }];
  r = await aiJson({ cid: 'c1', feature: 'x', system: 's', user: 'u', schema: sch });
  assert.ok(r.error && /400/.test(r.error));
  assert.equal(calls.length, 1, 'no retry on 400');
  assert.equal((await aiUsage('c1')).used, 2, 'failed call does not use up the limit');
  assert.equal((await aiUsage('c1')).failed, 1);

  // wrong shape: one repair attempt with the problem pointed out
  calls = [];
  script = [{ status: 200, content: '{"score":"nope","tags":[],"ok":true}' }, { status: 200, content: '{"score":7,"tags":[],"ok":true}' }];
  r = await aiJson({ cid: 'c1', feature: 'x', system: 's', user: 'u', schema: sch });
  assert.equal(r.data?.score, 7);
  assert.equal(calls.length, 2);
  assert.ok(String(calls[1].messages.at(-1).content).includes('score must be a number'));
  assert.equal((await aiUsage('c1')).used, 3, 'repair is not a second call against the limit');

  // limit reached
  r = await aiJson({ cid: 'c1', feature: 'x', system: 's', user: 'u' });
  assert.ok(r.error && /monthly AI limit/.test(r.error));
  // another company is unaffected
  script = [{ status: 200, content: '{"a":1}' }];
  assert.deepEqual((await aiJson({ cid: 'c2', feature: 'x', system: 's', user: 'u' })).data, { a: 1 });

  // cache: same input is not paid twice, and is not shared across companies
  process.env.AI_MONTHLY_CALLS = '50';
  calls = [];
  script = [{ status: 200, content: '{"v":1}' }, { status: 200, content: '{"v":2}' }];
  const a = await aiJson({ cid: 'c3', feature: 'x', system: 's', user: 'u', cacheKey: 'k' });
  const b = await aiJson({ cid: 'c3', feature: 'x', system: 's', user: 'u', cacheKey: 'k' });
  assert.equal(a.data.v, 1); assert.equal(b.data.v, 1); assert.equal(b.cached, true); assert.equal(calls.length, 1);
  const c = await aiJson({ cid: 'c4', feature: 'x', system: 's', user: 'u', cacheKey: 'k' });
  assert.equal(c.data.v, 2, 'other company does not read this company\'s cache');

  // text
  script = [{ status: 200, content: '  hello  ' }];
  assert.equal((await aiText({ cid: 'c5', feature: 'jd', system: 's', user: 'u' })).text, 'hello');

  console.log('ai.layer tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
