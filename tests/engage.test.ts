import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePrefixed } from '../api/_lib/prefixRouter.ts';
import { aggregate, cleanQuestions, shuffled, validateAnswers, MIN_ANON } from '../shared/engage.ts';

// ---- rules
assert.match(cleanQuestions([]).error!, /at least one/);
assert.match(cleanQuestions([{ type: 'CHOICE', text: 'x', options: ['a'] }]).error!, /two options/);
assert.match(cleanQuestions([{ type: 'NOPE', text: 'x' }]).error!, /type/);
const qs = cleanQuestions([{ type: 'RATING', text: 'Rate' }, { type: 'NPS', text: 'Recommend?' }, { type: 'CHOICE', text: 'Pick', options: ['a', 'b', 'a'] }, { type: 'MULTI', text: 'Many', options: ['x', 'y'], required: false }, { type: 'TEXT', text: 'Say', required: false }]).questions;
assert.deepEqual(qs.map((q) => q.id), ['q1', 'q2', 'q3', 'q4', 'q5']); assert.deepEqual(qs[2].options, ['a', 'b'], 'duplicate options removed');
const S = { questions: qs };
assert.match(validateAnswers(S, {}).error!, /Rate/);
assert.match(validateAnswers(S, { q1: 6, q2: 5, q3: 'a' }).error!, /1 to 5/);
assert.match(validateAnswers(S, { q1: 3, q2: 11, q3: 'a' }).error!, /0 to 10/);
assert.match(validateAnswers(S, { q1: 3, q2: 5, q3: 'zzz' }).error!, /options/);
assert.match(validateAnswers(S, { q1: 3, q2: 5, q3: 'a', q4: ['x', 'nope'] }).error!, /options/);
assert.deepEqual(validateAnswers(S, { q1: '4', q2: 9, q3: 'b', q4: ['x', 'x'], q5: '  hi  ' }).answers, { q1: 4, q2: 9, q3: 'b', q4: ['x'], q5: 'hi' });
const agg = aggregate(S, [
  { answers: { q1: 5, q2: 10, q3: 'a', q4: ['x', 'y'], q5: 'good' } }, { answers: { q1: 3, q2: 6, q3: 'a' } }, { answers: { q1: 4, q2: 8, q3: 'b' } }, { answers: { q1: 4, q2: 9, q3: 'a', q5: 'ok' } },
]);
assert.equal((agg[0] as any).average, 4); assert.deepEqual((agg[0] as any).distribution, [0, 0, 1, 2, 1]);
assert.equal((agg[1] as any).promoters, 2); assert.equal((agg[1] as any).detractors, 1); assert.equal((agg[1] as any).score, 25);
assert.deepEqual((agg[2] as any).counts, { a: 3, b: 1 }); assert.deepEqual((agg[3] as any).counts, { x: 1, y: 1 });
assert.equal((agg[4] as any).texts.length, 2);
assert.deepEqual(shuffled([1, 2, 3, 4, 5, 6], 's'), shuffled([1, 2, 3, 4, 5, 6], 's'), 'shuffle is stable'); assert.equal(shuffled([1, 2, 3], 's').length, 3);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tok('hr', ['engage.manage']);
fdb.seed('companies', 'c1', { name: 'A' }); fdb.seed('companies', 'c2', { name: 'B' });
const uids = ['hr', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
uids.forEach((uid, i) => fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name: `Person ${uid}`, email: `${uid}@a.com`, active: true, departmentName: i < 4 ? 'Ops' : 'Sales', createdAt: '2020-01-01T00:00:00Z' }));
const call = async (h: any, method: string, action: string, body: any = {}, query: any = {}) => (await routePrefixed(`engage-${action}`, { method, query, body, headers: h }))!;
const questions = [{ type: 'RATING', text: 'How is work?' }, { type: 'TEXT', text: 'Comments', required: false }];

assert.equal((await call(tok('u1'), 'POST', 'save-survey', { title: 'x', questions })).status, 403);
assert.equal((await call(HR, 'POST', 'save-survey', { title: '', questions })).status, 400);
assert.equal((await call(HR, 'POST', 'save-survey', { title: 'x', questions: [] })).status, 400);
let r = await call(HR, 'POST', 'save-survey', { title: 'Pulse', questions, anonymous: true, audience: { kind: 'DEPARTMENTS', departments: ['Ops'] } });
assert.equal(r.status, 200); const sid = r.json.id;
assert.equal((await call(tok('u1'), 'GET', 'surveys')).json.items.length, 0, 'drafts are hidden');
assert.equal((await call(tok('u1'), 'POST', 'respond', { id: sid, answers: { q1: 4 } })).status, 409, 'not open yet');
assert.equal((await call(HR, 'POST', 'publish-survey', { id: sid })).status, 200);
assert.equal((await call(HR, 'POST', 'publish-survey', { id: sid })).status, 409);
assert.equal((await call(HR, 'POST', 'save-survey', { id: sid, title: 'Changed', questions })).status, 409, 'open surveys are not editable');
assert.equal((await call(tok('u1'), 'GET', 'surveys')).json.items.length, 1);
assert.equal((await call(tok('u5'), 'GET', 'surveys')).json.items.length, 0, 'Sales is outside the audience');
assert.equal((await call(tok('u5'), 'POST', 'respond', { id: sid, answers: { q1: 4 } })).status, 403);
const sv = await call(tok('u1'), 'GET', 'survey', {}, { id: sid });
assert.equal(sv.json.survey.salt, undefined, 'the salt never leaves the server');
assert.equal((await call(tok('u1'), 'POST', 'respond', { id: sid, answers: {} })).status, 400);
assert.equal((await call(tok('u1'), 'POST', 'respond', { id: sid, answers: { q1: 4, q2: 'fine' } })).status, 200);
assert.equal((await call(tok('u1'), 'POST', 'respond', { id: sid, answers: { q1: 5 } })).status, 409, 'once per person');
assert.equal((await call(tok('u1'), 'GET', 'surveys')).json.items[0].answered, true);
assert.equal((await call(tok('u1'), 'GET', 'results', {}, { id: sid })).status, 403);
let res = await call(HR, 'GET', 'results', {}, { id: sid });
assert.equal(res.json.hidden, true, `hidden below ${MIN_ANON} answers`); assert.equal(res.json.questions, undefined);
// what is stored for an anonymous answer holds no identity
const stored = (await fdb.collection('surveyResponses').where('companyId', '==', 'c1').get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
assert.equal(stored.length, 1); assert.equal(stored[0].uid, undefined); assert.equal(stored[0].name, undefined); assert.ok(!stored[0].id.includes('u1')); assert.match(stored[0].submittedAt, /^\d{4}-\d{2}-\d{2}$/);
// five Ops people are needed; only four exist in Ops (hr, u1-u3), so add answers from the ones we have then widen the audience
for (const u of ['u2', 'u3', 'hr']) assert.equal((await call(tok(u), 'POST', 'respond', { id: sid, answers: { q1: 3 } })).status, 200);
assert.equal((await call(HR, 'GET', 'results', {}, { id: sid })).json.hidden, true, '4 answers is still below the minimum');
// a second survey, named, open to all
r = await call(HR, 'POST', 'save-survey', { title: 'Named', questions, anonymous: false }); const nid = r.json.id;
await call(HR, 'POST', 'publish-survey', { id: nid });
for (const u of uids) await call(tok(u), 'POST', 'respond', { id: nid, answers: { q1: 4, q2: `from ${u}` } });
res = await call(HR, 'GET', 'results', {}, { id: nid });
assert.equal(res.json.hidden, false); assert.equal(res.json.responses, 7); assert.equal(res.json.questions[0].average, 4); assert.equal(res.json.questions[1].texts.length, 7);
assert.equal((await call(HR, 'POST', 'close-survey', { id: nid })).status, 200);
assert.equal((await call(tok('u1'), 'POST', 'respond', { id: nid, answers: { q1: 1 } })).status, 409, 'closed');
assert.equal((await call(tok('other', ['engage.manage'], 'c2'), 'GET', 'results', {}, { id: nid })).status, 404);
assert.equal((await call(HR, 'POST', 'delete-survey', { id: nid })).status, 200);
assert.equal((await fdb.collection('surveyResponses').where('surveyId', '==', nid).get()).docs.length, 0, 'answers go with the survey');

// ---- wall
assert.equal((await call(tok('u1'), 'POST', 'post', { text: 'Hello team' })).status, 200);
assert.equal((await call(tok('u1'), 'POST', 'post', { text: '   ' })).status, 400);
assert.equal((await call(tok('u1'), 'POST', 'post', { text: 'x'.repeat(2001) })).status, 400);
assert.equal((await call(tok('u1'), 'POST', 'post', { text: 'Big news', kind: 'ANNOUNCEMENT' })).status, 403, 'only managers announce');
assert.equal((await call(tok('u1'), 'POST', 'post', { text: 'Thanks', kind: 'KUDOS', kudosTo: [] })).status, 400);
assert.equal((await call(tok('u1'), 'POST', 'post', { text: 'Thanks', kind: 'KUDOS', kudosTo: ['u1', 'ghost'] })).status, 400, 'cannot thank yourself or strangers');
r = await call(tok('u1'), 'POST', 'post', { text: 'Thanks for the help', kind: 'KUDOS', kudosTo: ['u2'] }); assert.equal(r.status, 200); const kid = r.json.id;
const ann = (await call(HR, 'POST', 'post', { text: 'Office closed Friday', kind: 'ANNOUNCEMENT' })).json.id;
assert.equal((await call(tok('u2'), 'POST', 'pin', { postId: ann, pinned: true })).status, 403);
assert.equal((await call(HR, 'POST', 'pin', { postId: ann, pinned: true })).status, 200);
let feed = (await call(tok('u2'), 'GET', 'feed')).json;
assert.equal(feed.items[0].id, ann, 'pinned first'); assert.equal(feed.items.length, 3);
assert.equal((await call(tok('u2'), 'POST', 'react', { postId: kid, reaction: 'CELEBRATE' })).json.on, true);
assert.equal((await call(tok('u2'), 'POST', 'react', { postId: kid, reaction: 'BAD' })).status, 400);
feed = (await call(tok('u2'), 'GET', 'feed')).json; const k = feed.items.find((p: any) => p.id === kid);
assert.equal(k.reactions.CELEBRATE, 1); assert.deepEqual(k.myReactions, ['CELEBRATE']);
assert.equal((await call(tok('u2'), 'POST', 'react', { postId: kid, reaction: 'CELEBRATE' })).json.on, false, 'second tap removes it');
r = await call(tok('u2'), 'POST', 'comment', { postId: kid, text: 'Anytime!' }); const cid = r.json.id;
assert.equal((await call(tok('u2'), 'POST', 'comment', { postId: kid, text: '' })).status, 400);
assert.equal((await call(tok('u2'), 'POST', 'comment', { postId: 'nope', text: 'x' })).status, 404);
assert.equal((await call(tok('u3'), 'POST', 'delete-comment', { id: cid })).status, 403);
assert.equal((await call(HR, 'POST', 'delete-comment', { id: cid })).status, 200, 'moderators can remove comments');
assert.equal((await call(tok('u3'), 'POST', 'delete-post', { postId: kid })).status, 403);
assert.equal((await call(tok('u1'), 'POST', 'delete-post', { postId: kid })).status, 200);
assert.equal((await call(tok('other', [], 'c2'), 'GET', 'feed')).json.items.length, 0, 'other company sees nothing');
for (let i = 0; i < 20; i++) await call(tok('u4'), 'POST', 'post', { text: `p${i}` });
assert.equal((await call(tok('u4'), 'POST', 'post', { text: 'one more' })).status, 429, 'daily limit');
console.log('engage ok');
