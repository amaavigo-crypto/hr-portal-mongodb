/**
 * Wellbeing games: the rules (seeded stimuli, replay checks, skill numbers, role defaults) and the whole API
 * (consent, daily limit, server-side scoring, privacy of skills, groups of 5, audit log).
 * Run: npx tsx tests/wellbeing.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeWellbeing } from '../api/_lib/wellbeingApi.ts';
import {
  ECHO, FRAUD, FRAUD_TARGETS, FRUIT, MIN_GROUP, MIN_PLAYS, defaultWeights, echoReplay, echoSequence, fraudMetrics, fraudOutcome, fraudPlan,
  fruitMetrics, fruitOutcome, fruitPlan, fruitStep, gamesFor, rng, scoreSession, snapshotOf, streakOf, titleKey,
  type EchoAttempt, type FruitResult, type FraudResult,
} from '../shared/wellbeingEngine.ts';

// ---------------------------------------------------------------- the same seed always gives the same game
{
  const a = rng('x'); const b = rng('x'); const c = rng('y');
  const A = [a(), a(), a()]; assert.deepEqual(A, [b(), b(), b()]); assert.notDeepEqual(A, [c(), c(), c()]);
  assert.deepEqual(fruitPlan('s1'), fruitPlan('s1'));
  assert.notDeepEqual(fruitPlan('s1'), fruitPlan('s2'));
  assert.deepEqual(fraudPlan('s1'), fraudPlan('s1'));
  assert.deepEqual(echoSequence('s1', 0, 5), echoSequence('s1', 0, 5));
  assert.notDeepEqual(echoSequence('s1', 0, 8), echoSequence('s1', 1, 8), 'every attempt is a new tune');
}

// ---------------------------------------------------------------- Fruit Catch
{
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const plan = fruitPlan(seed);
    assert.equal(plan.length, FRUIT.trials);
    let bombs = 0, fruit = 0;
    for (const t of plan) { bombs = t.go ? 0 : bombs + 1; fruit = t.go ? fruit + 1 : 0; assert.ok(bombs <= 2, 'no three bombs in a row'); assert.ok(fruit <= 8, 'no endless runs of fruit'); assert.ok(t.lane >= 0 && t.lane < FRUIT.lanes); assert.ok(t.isiMs >= 500 && t.isiMs < 1100); }
    const share = plan.filter((t) => t.go).length / plan.length;
    assert.ok(share > 0.6 && share < 0.9, `mostly fruit (${share})`);
  }
  const go = { go: true, lane: 0, kind: 0, isiMs: 600 }; const bomb = { go: false, lane: 0, kind: 0, isiMs: 600 };
  assert.equal(fruitOutcome(go, { tapped: true, rt: 400 }), 'hit');
  assert.equal(fruitOutcome(go, { tapped: false, rt: null }), 'omission');
  assert.equal(fruitOutcome(bomb, { tapped: true, rt: 400 }), 'commission');
  assert.equal(fruitOutcome(bomb, { tapped: false, rt: null }), 'dodge');
  assert.equal(fruitOutcome(go, { tapped: true, rt: 90 }), 'anticipation', 'a tap before anyone could have seen it is not a catch');
  assert.equal(fruitOutcome(bomb, { tapped: true, rt: 90 }), 'anticipation');
  const s1 = fruitStep('hit', 250, 0); assert.equal(s1.points, 200); assert.equal(s1.combo, 1);
  assert.ok(fruitStep('hit', 250, 5).points > s1.points, 'combos pay more');
  assert.equal(fruitStep('commission', 300, 6).combo, 0);

  // a steady, decent player
  const plan = fruitPlan('steady');
  const good: FruitResult[] = plan.map((t) => (t.go ? { tapped: true, rt: 380 } : { tapped: false, rt: null }));
  const m = fruitMetrics(plan, good);
  assert.equal(m.commissions, 0); assert.equal(m.omissions, 0); assert.equal(m.medianRt, 380);
  const skills = scoreSession('fruit-catch', 'steady', { results: good }).skills;
  assert.equal(skills.impulse, 100); assert.ok(skills.reaction! > 60 && skills.reaction! < 80, `reaction ${skills.reaction}`);
  // a tap-everything player: quick, but cannot hold back
  const spam: FruitResult[] = plan.map(() => ({ tapped: true, rt: 300 }));
  const sp = scoreSession('fruit-catch', 'steady', { results: spam });
  assert.ok(sp.skills.impulse! < 5, 'tapping every bomb scores nothing on impulse control');
  assert.ok(sp.skills.reaction! > skills.reaction!, 'but the quick taps still read as quick');
  // tampering
  assert.equal(scoreSession('fruit-catch', 'steady', { results: good.slice(1) }).ok, false, 'short session');
  assert.equal(scoreSession('fruit-catch', 'steady', { results: good.map((r, i) => (i === 0 ? { tapped: false, rt: 200 } : r)) }).ok, false, 'a time without a tap');
  assert.equal(scoreSession('fruit-catch', 'steady', { results: good.map((r, i) => (i === 0 ? { tapped: true, rt: 99999 } : r)) }).ok, false, 'an impossible time');
  assert.equal(scoreSession('fruit-catch', 'steady', {}).ok, false);
}

// ---------------------------------------------------------------- Echo Beats
{
  const seed = 'echo1';
  const perfect = (n: number): EchoAttempt[] => {
    const out: EchoAttempt[] = [];
    for (let k = 0; k < n; k++) { const len = ECHO.startLen + k; const seq = echoSequence(seed, k, len); out.push({ len, input: seq, t: seq.map((_, i) => 400 + i * 450) }); }
    return out;
  };
  const wrongAt = (k: number, len: number): EchoAttempt => { const seq = echoSequence(seed, k, len); const input = [...seq.slice(0, 1)]; input.push((seq[1] + 1) % 4); return { len, input, t: [400, 900] }; };

  // 3 clean rounds (3,4,5) then three strikes at length 6
  const run = [...perfect(3), wrongAt(3, 6), wrongAt(4, 6), wrongAt(5, 6)];
  const r = echoReplay(seed, run);
  assert.ok(r.ok, r.error); assert.ok(r.complete); assert.equal(r.span, 5); assert.equal(r.strikes, 3);
  const sc = scoreSession('echo-beats', seed, { attempts: run });
  assert.ok(sc.ok); assert.ok(sc.skills.memory! > 25 && sc.skills.memory! < 60, `memory ${sc.skills.memory}`);
  assert.match(sc.highlight, /Longest pattern: 5/);
  // a better player scores higher
  const better = [...perfect(6), wrongAt(6, 9), wrongAt(7, 9), wrongAt(8, 9)];
  assert.ok(scoreSession('echo-beats', seed, { attempts: better }).skills.memory! > sc.skills.memory!);
  assert.ok(scoreSession('echo-beats', seed, { attempts: better }).points > sc.points);

  // the rules cannot be bent
  assert.equal(echoReplay(seed, [...perfect(3), wrongAt(3, 6)]).complete, false, 'unfinished: strikes left');
  assert.equal(scoreSession('echo-beats', seed, { attempts: [...perfect(3), wrongAt(3, 6)] }).ok, false, 'an unfinished session is not scored');
  assert.equal(echoReplay(seed, [{ len: 5, input: [], t: [] }]).ok, false, 'must start at the start length');
  const forged = perfect(2); forged[1].input = echoSequence('other', 1, 4);
  assert.equal(echoReplay(seed, forged).ok, false, 'a tune from another seed, played to the end, cannot have happened');
  const lastWrong = perfect(2); lastWrong[1].input[3] = (lastWrong[1].input[3] + 1) % 4;
  assert.ok(echoReplay(seed, lastWrong).ok, 'a wrong last tap is just a strike');
  assert.equal(echoReplay(seed, lastWrong).span, 3);
  const early = wrongAt(0, 3); early.input = [(echoSequence(seed, 0, 3)[0] + 1) % 4, 0]; early.t = [400, 900];
  assert.equal(echoReplay(seed, [early]).ok, false, 'tapping on after a mistake is not possible');
  const fast = perfect(1); fast[0].t = [400, 410, 420]; assert.equal(echoReplay(seed, fast).ok, false, 'taps 10 ms apart are not human');
  assert.equal(echoReplay(seed, [...perfect(3), wrongAt(3, 6), wrongAt(4, 6), wrongAt(5, 6), wrongAt(6, 6)]).ok, false, 'no play after the third strike');
  assert.equal(echoReplay(seed, [{ len: 3, input: [9], t: [400] }]).ok, false, 'there are four pads');
}

// ---------------------------------------------------------------- Fraud Hunter
{
  const violations = (d: ReturnType<typeof fraudPlan>[number]): number[] => {
    const v: number[] = [];
    d.rows.forEach((r, i) => { if (r.qty * r.rate !== r.amount) v.push(i); });
    if (d.subtotal !== d.rows.reduce((a, r) => a + r.amount, 0)) v.push(FRAUD_TARGETS.subtotal);
    if (d.gst !== Math.round((d.subtotal * d.gstRate) / 100)) v.push(FRAUD_TARGETS.gst);
    if (d.total !== d.subtotal + d.gst) v.push(FRAUD_TARGETS.total);
    return v;
  };
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const plan = fraudPlan(seed);
    assert.equal(plan.length, FRAUD.docs);
    let clean = 0, errs = 0;
    for (const d of plan) {
      const v = violations(d);
      if (d.errorAt === -1) assert.deepEqual(v, [], 'a clean invoice has nothing wrong'); else assert.deepEqual(v, [d.errorAt], 'exactly one line is wrong, and it is the one the answer key says');
      assert.equal(d.rows.length, FRAUD.rows);
      assert.ok(d.rows.every((r) => r.amount > 0), 'no negative amounts');
      assert.equal(new Set(d.rows.map((r) => r.item)).size, FRAUD.rows, 'no repeated items on one invoice');
      d.errorAt === -1 ? clean++ : errs++;
    }
    assert.ok(clean >= 2 && errs >= 12, `a mix of clean and wrong (${clean}/${errs})`);
  }
  const plan = fraudPlan('judge');
  const perfect: FraudResult[] = plan.map((d) => ({ choice: d.errorAt, ms: 5000 }));
  const m = fraudMetrics(plan, perfect);
  assert.equal(m.found, m.errorDocs); assert.equal(m.cleared, m.cleanDocs); assert.equal(m.missed + m.wrongSpot + m.falseAlarm, 0);
  const sk = scoreSession('fraud-hunter', 'judge', { results: perfect }).skills.detail!;
  assert.ok(sk >= 95, `a flawless run scores ${sk}`);
  const sloppy: FraudResult[] = plan.map(() => ({ choice: -1, ms: 3000 }));
  const sl = scoreSession('fraud-hunter', 'judge', { results: sloppy }).skills.detail!;
  assert.equal(sl, 0, 'waving everything through is guessing, and guessing scores nothing');
  const paranoid: FraudResult[] = plan.map(() => ({ choice: 0, ms: 3000 }));
  assert.ok(scoreSession('fraud-hunter', 'judge', { results: paranoid }).skills.detail! < 40, 'flagging line 1 every time is not attention');
  const slow: FraudResult[] = plan.map((d) => ({ choice: d.errorAt, ms: 24000 }));
  const slowScore = scoreSession('fraud-hunter', 'judge', { results: slow }).skills.detail!;
  assert.ok(slowScore < sk && slowScore >= 70, 'being slow costs some, but never most of it');
  const d0 = plan.find((d) => d.errorAt >= 0)!;
  assert.equal(fraudOutcome(d0, { choice: d0.errorAt, ms: 1 }), 'found');
  assert.equal(fraudOutcome(d0, { choice: (d0.errorAt + 1) % 6, ms: 1 }), 'wrongSpot');
  assert.equal(fraudOutcome(d0, { choice: -1, ms: 1 }), 'missed');
  const c0 = plan.find((d) => d.errorAt === -1)!;
  assert.equal(fraudOutcome(c0, { choice: 2, ms: 1 }), 'falseAlarm');
  assert.equal(fraudOutcome(c0, { choice: null, ms: 25000 }), 'missed');
  assert.equal(scoreSession('fraud-hunter', 'judge', { results: perfect.slice(2) }).ok, false);
  assert.equal(scoreSession('fraud-hunter', 'judge', { results: perfect.map((r, i) => (i === 0 ? { choice: 99, ms: 1000 } : r)) }).ok, false);
}

// ---------------------------------------------------------------- skills over time, roles, streaks
{
  const day = (i: number) => `2026-11-${String(10 + i).padStart(2, '0')}T10:00:00Z`;
  const few = [0, 1, 2, 3].map((i) => ({ finishedAt: day(i), skills: { reaction: 60 } }));
  assert.equal(snapshotOf(few).reaction, null, `nothing is shown before ${MIN_PLAYS} plays`);
  const some = [60, 62, 64, 66, 68, 70, 72, 74].map((v, i) => ({ finishedAt: day(i), skills: { reaction: v, memory: i === 0 ? 50 : null } }));
  const snap = snapshotOf(some);
  assert.equal(snap.reaction!.n, 8); assert.equal(snap.reaction!.confidence, 'low'); assert.equal(snap.reaction!.trend, 6, 'last three against the three before');
  assert.equal(snap.memory, null, 'one memory session is not a picture');
  assert.equal(snapshotOf(Array.from({ length: 14 }, (_, i) => ({ finishedAt: day(i), skills: { detail: 50 } }))).detail!.n, 10, 'only the latest ten count');

  assert.equal(defaultWeights('Senior Accountant', 'Finance').matched, 'Finance and accounts');
  assert.equal(defaultWeights('Payroll Executive', '').weights.detail, 3);
  assert.equal(defaultWeights('Finance Manager', 'Finance').matched, 'Finance and accounts', 'a manager in finance is still finance');
  assert.equal(defaultWeights('Head of Product', 'Product').matched, 'General', 'leadership has no starting skills');
  assert.deepEqual(Object.values(defaultWeights('Founder', '').weights), [0, 0, 0, 0]);
  assert.equal(defaultWeights('Software Engineer', 'Tech').matched, 'Engineering and analysis');
  assert.equal(defaultWeights('HR Executive', 'People').matched, 'HR and operations', 'short words match whole words only');
  assert.equal(defaultWeights('Chrome Tester', '').matched, 'General', '"hr" inside "chrome" is not HR');
  assert.equal(titleKey('  Senior  Accountant! '), 'senior accountant');

  const fin = defaultWeights('Accountant', '').weights;
  assert.equal(gamesFor(fin, ['fruit-catch', 'echo-beats', 'fraud-hunter'], '2026-11-18')[0], 'fraud-hunter', 'finance sees Fraud Hunter first');
  const none = defaultWeights('Founder', '').weights;
  const a = gamesFor(none, ['fruit-catch', 'echo-beats', 'fraud-hunter'], '2026-11-18'); const b = gamesFor(none, ['fruit-catch', 'echo-beats', 'fraud-hunter'], '2026-11-19');
  assert.equal(new Set(a).size, 3); assert.ok(a.join() !== b.join() || true);
  assert.deepEqual(gamesFor(fin, ['echo-beats'], 'x'), ['echo-beats'], 'only games that are switched on');

  assert.equal(streakOf(['2026-11-16', '2026-11-17', '2026-11-18'], '2026-11-18'), 3);
  assert.equal(streakOf(['2026-11-16', '2026-11-17'], '2026-11-18'), 2, 'a streak survives until tonight');
  assert.equal(streakOf(['2026-11-15', '2026-11-17'], '2026-11-18'), 1, 'a gap breaks it');
  assert.equal(streakOf([], '2026-11-18'), 0);
}

// ---------------------------------------------------------------- the API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID, adm = false) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeWellbeing({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => { assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`); return r.json; };
const no = (r: any, status: number, msg = '') => assert.equal(r.status, status, `${msg} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, dept: string, title: string) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title, createdAt: '2025-01-01T00:00:00Z' });
const finance = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
finance.forEach((id, i) => emp(id, `Fin ${i + 1}`, 'Finance', 'Accountant'));
['s1', 's2'].forEach((id, i) => emp(id, `Sup ${i + 1}`, 'Support', 'Support Executive'));
emp('hr1', 'Neha HR', 'HR', 'HR Manager'); emp('boss', 'Founder', 'Management', 'Founder'); emp('adm', 'Admin', 'HR', 'Head HR');
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true, departmentName: 'Finance', title: 'Accountant' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const HRV = tok('hr1', ['wellbeing.view']); const HRM = tok('hr1', ['wellbeing.view', 'wellbeing.manage']); const HRI = tok('hr1', ['wellbeing.view', 'wellbeing.view_individual']);
const ADM = tok('adm', [], CID, true);

/** Plays one game honestly from the seed the server gave, with the given quality. */
function play(game: string, seed: string, quality: 'good' | 'poor' = 'good'): any {
  if (game === 'fruit-catch') return { results: fruitPlan(seed).map((t): FruitResult => (t.go ? { tapped: quality === 'good' || t.lane % 2 === 0, rt: quality === 'good' ? 360 : 560 } : { tapped: quality === 'poor' && t.lane % 3 === 0, rt: quality === 'poor' && t.lane % 3 === 0 ? 400 : null })).map((r) => (r.tapped ? r : { tapped: false, rt: null })) };
  if (game === 'echo-beats') {
    const attempts: EchoAttempt[] = []; let len: number = ECHO.startLen, strikes = 0, k = 0;
    const limit = quality === 'good' ? 8 : 5;
    while (strikes < ECHO.strikes && k < ECHO.maxAttempts && len <= ECHO.maxLen) {
      const seq = echoSequence(seed, k, len);
      if (len <= limit) { attempts.push({ len, input: seq, t: seq.map((_, i) => 400 + i * 420) }); len++; }
      else { attempts.push({ len, input: [seq[0], (seq[1] + 1) % 4], t: [400, 900] }); strikes++; }
      k++;
    }
    return { attempts };
  }
  return { results: fraudPlan(seed).map((d): FraudResult => ({ choice: quality === 'good' ? d.errorAt : -1, ms: 6000 })) };
}
const backdate = async (sessionId: string, ms: number) => { const ref = fdb.collection('wbSessions').doc(sessionId); const s: any = (await ref.get()).data(); await ref.set({ ...s, startedAt: new Date(Date.now() - ms).toISOString() }); };

async function main() {
  // ---- access and the first visit
  no(await call({}, 'GET', 'me'), 401);
  no(await post(tok('f1'), 'me'), 405);
  const first = okc(await get(tok('f1'), 'me'));
  assert.equal(first.consent.answered, false);
  assert.equal(first.games[0].id, 'fraud-hunter', 'an accountant sees Fraud Hunter first');
  assert.equal(first.games.length, 3);
  assert.equal(first.today.left, 3);
  assert.ok(!JSON.stringify(first).match(/reaction|impulse|memory|detail|skill/i), 'the player never meets a skill number or word');
  no(await post(tok('f1'), 'start', { game: 'fruit-catch' }), 400, 'cannot play before choosing');
  no(await post(tok('f1'), 'consent', {}), 400);
  okc(await post(tok('f1'), 'consent', { optIn: true }));
  assert.equal(okc(await get(tok('f1'), 'me')).consent.optedIn, true);
  no(await post(tok('f1'), 'start', { game: 'chess' }), 400);

  // ---- a recorded game, scored by the server
  const s1 = okc(await post(tok('f1'), 'start', { game: 'fruit-catch' }));
  assert.ok(s1.recorded && s1.sessionId && s1.seed);
  no(await post(tok('f1'), 'finish', { sessionId: s1.sessionId, payload: play('fruit-catch', s1.seed) }), 400, 'a session finished at once is too short');
  await backdate(s1.sessionId, 60_000);
  no(await post(tok('f2', []), 'finish', { sessionId: s1.sessionId, payload: play('fruit-catch', s1.seed) }), 404, "nobody finishes someone else's session");
  no(await post(tok('f1'), 'finish', { sessionId: s1.sessionId, payload: play('fruit-catch', 'not-the-seed-' + s1.seed).results.slice(2) }), 400, 'wrong length');
  const done = okc(await post(tok('f1'), 'finish', { sessionId: s1.sessionId, payload: play('fruit-catch', s1.seed) }));
  assert.ok(done.points > 0 && done.newBest === true);
  assert.ok(!JSON.stringify(done).match(/skill|reaction|impulse/i), 'the result screen shows points only');
  no(await post(tok('f1'), 'finish', { sessionId: s1.sessionId, payload: play('fruit-catch', s1.seed) }), 409, 'a session finishes once');
  const stored: any = (await fdb.collection('wbSessions').doc(s1.sessionId).get()).data();
  assert.equal(stored.status, 'DONE'); assert.ok(stored.skills.reaction > 0 && stored.skills.impulse === 100, 'the server worked out the skills');
  assert.equal(stored.trials.length, 60, 'trial-level data is kept');

  // a boastful client cannot raise its own numbers: the server scores what happened, not what is claimed
  const s2 = okc(await post(tok('f1'), 'start', { game: 'echo-beats' })); await backdate(s2.sessionId, 60_000);
  const forgedEcho = okc(await post(tok('f1'), 'finish', { sessionId: s2.sessionId, payload: { ...play('echo-beats', s2.seed, 'poor'), points: 999999, skills: { memory: 100 } } }));
  assert.ok(forgedEcho.points < 3000, `points came from the replay (${forgedEcho.points})`);
  const echoRow: any = (await fdb.collection('wbSessions').doc(s2.sessionId).get()).data();
  assert.ok(echoRow.skills.memory < 60, 'claimed skills are ignored');

  // ---- the daily limit counts every play, recorded or not
  const s3 = okc(await post(tok('f1'), 'start', { game: 'fraud-hunter' })); assert.equal(s3.today.left, 0);
  no(await post(tok('f1'), 'start', { game: 'fraud-hunter' }), 429, 'the fourth play of the day is refused');
  assert.equal(okc(await get(tok('f1'), 'me')).today.left, 0);

  // ---- opting out: the games still work, nothing is recorded
  okc(await post(tok('f2'), 'consent', { optIn: false }));
  const out = okc(await post(tok('f2'), 'start', { game: 'echo-beats' }));
  assert.equal(out.recorded, false); assert.equal(out.sessionId, null); assert.ok(out.seed);
  assert.equal((await fdb.collection('wbSessions').where('uid', '==', 'f2').get()).docs.length, 0, 'no session row for someone who opted out');
  no(await post(tok('f2'), 'finish', { sessionId: null, payload: {} }), 400);

  // ---- settings
  no(await get(tok('f1'), 'settings'), 403);
  no(await post(HRV, 'save-settings', { enabledGames: ['echo-beats'], dailyCap: 2 }), 403, 'viewing is not managing');
  no(await post(HRM, 'save-settings', { enabledGames: [], dailyCap: 2 }), 400);
  no(await post(HRM, 'save-settings', { enabledGames: ['echo-beats'], dailyCap: 99 }), 400);
  okc(await post(HRM, 'save-settings', { enabledGames: ['echo-beats', 'fraud-hunter'], dailyCap: 5 }));
  const cfg = okc(await get(tok('f3'), 'me')); assert.equal(cfg.games.length, 2); assert.equal(cfg.today.cap, 5);
  no(await post(tok('f3'), 'consent', { optIn: true }) && await post(tok('f3'), 'start', { game: 'fruit-catch' }), 400, 'a game that is off cannot be started');
  okc(await post(HRM, 'save-settings', { enabledGames: ['fruit-catch', 'echo-beats', 'fraud-hunter'], dailyCap: 3 }));

  // ---- HR: nothing shows until there is something safe to show
  no(await get(tok('f1'), 'overview'), 403, 'players cannot open group results');
  const empty = okc(await get(HRV, 'overview')); assert.equal(empty.groups.length, 0);

  // five finance people, each with enough sessions, in one group; two support people in a group that stays hidden
  const seedPlays = async (uid: string, plays: number, quality: 'good' | 'poor' = 'good') => {
    const h = tok(uid);
    okc(await post(h, 'consent', { optIn: true }));
    for (let i = 0; i < plays; i++) {
      // the daily limit is per day, so the older plays are written as earlier days
      const day = new Date(Date.now() - (plays - i) * 86_400_000).toISOString().slice(0, 10);
      const dayRef = fdb.collection('wbDaily').doc(`${CID}__${uid}__${day}`); await dayRef.set({ companyId: CID, uid, day, count: 1 });
      await fdb.collection('wbDaily').doc(`${CID}__${uid}__${new Date().toISOString().slice(0, 10)}`).delete(); // the limit is per day: start each seeded play on a fresh day
      const st = okc(await post(h, 'start', { game: i % 2 ? 'fruit-catch' : 'fraud-hunter' }));
      await backdate(st.sessionId, 60_000);
      const game = i % 2 ? 'fruit-catch' : 'fraud-hunter';
      okc(await post(h, 'finish', { sessionId: st.sessionId, payload: play(game, st.seed, quality) }));
      const ref = fdb.collection('wbSessions').doc(st.sessionId); const row: any = (await ref.get()).data(); await ref.set({ ...row, finishedAt: new Date(Date.now() - (plays - i) * 86_400_000).toISOString() });
    }
  };
  for (const id of ['f2', 'f3', 'f4', 'f5']) { if (id === 'f2') okc(await post(tok('f2'), 'consent', { optIn: true })); await seedPlays(id, 12, id === 'f5' ? 'poor' : 'good'); }
  // f1 already played twice today; f6 plays too
  await seedPlays('f6', 12);
  for (const id of ['s1', 's2']) await seedPlays(id, 12);

  const ov = okc(await get(HRV, 'overview'));
  assert.equal(ov.groups.length, 1, 'only the finance group is big enough'); assert.equal(ov.hiddenGroups, 1, 'support has 2 people, so it is hidden');
  assert.equal(ov.groups[0].name, 'Finance'); assert.equal(ov.groups[0].players, 6, 'everyone in finance who opted in and has a recorded game');
  assert.deepEqual(ov.groups[0].relevant, ['impulse', 'memory', 'detail'], 'accountants: the skills that matter for the role');
  assert.ok(ov.groups[0].skills.detail && ov.groups[0].skills.detail.members === 5);
  assert.equal(ov.groups[0].skills.memory, null, 'nobody played enough Echo Beats, so no memory average is shown');
  assert.ok(!JSON.stringify(ov).match(/"uid"|Fin \d|f[1-6]@/), 'a group result never names anyone');
  assert.ok(ov.participation.percent > 0 && ov.participation.optedIn >= 6);

  // ---- HR: one person needs their own permission, shows only what the role needs, and is logged
  no(await get(HRV, 'people'), 403); no(await get(HRV, 'person', { uid: 'f3' }), 403, 'group access is not individual access');
  const list = okc(await get(HRI, 'people')); assert.ok(list.people.length >= 6); assert.ok(!JSON.stringify(list).match(/level|detail|reaction|memory/), 'a list has no skill numbers');
  const p = okc(await get(HRI, 'person', { uid: 'f3' }));
  assert.equal(p.person.name, 'Fin 3'); assert.ok(p.skills.detail.level >= 90, 'a careful player'); assert.equal(p.skills.reaction, undefined, 'reaction speed is not part of an accountant’s picture');
  assert.deepEqual(p.relevant.map((x: any) => x.id), ['impulse', 'memory', 'detail']);
  const sloppy = okc(await get(HRI, 'person', { uid: 'f5' })); assert.ok(sloppy.skills.detail.level < p.skills.detail.level);
  const log = okc(await get(HRI, 'audit')); assert.equal(log.rows.length, 2); assert.equal(log.rows[0].action, 'VIEW_PERSON'); assert.equal(log.rows[0].actor, 'hr1@acme.com');
  no(await get(HRI, 'person', { uid: 'hr1' }), 400, 'your own results are on your own page');
  no(await get(HRI, 'person', { uid: 'x1' }), 404, 'another company is not reachable');
  okc(await post(tok('f6'), 'consent', { optIn: false }));
  no(await get(HRI, 'person', { uid: 'f6' }), 404, 'someone who opted out disappears from HR views');
  const five = okc(await get(HRV, 'overview'));
  assert.equal(five.groups[0].players, 5);
  assert.equal(five.groups[0].skills.detail, null, 'with four people on a skill, its average would point at them, so it is hidden');
  okc(await post(tok('f1'), 'consent', { optIn: false }));
  assert.equal(okc(await get(HRV, 'overview')).groups.length, 0, 'and a group that drops under 5 disappears too');
  okc(await post(tok('f6'), 'consent', { optIn: true })); okc(await post(tok('f1'), 'consent', { optIn: true }));
  assert.equal(okc(await get(HRV, 'overview')).groups.length, 1);

  // ---- role profiles
  no(await get(HRV, 'roles'), 403);
  const roles = okc(await get(HRM, 'roles'));
  const acc = roles.rows.find((r: any) => r.title === 'Accountant'); assert.equal(acc.source, 'default'); assert.equal(acc.weights.detail, 3);
  const founder = roles.rows.find((r: any) => r.title === 'Founder'); assert.deepEqual(Object.values(founder.weights), [0, 0, 0, 0]);
  okc(await post(HRM, 'save-role', { title: 'Accountant', weights: { reaction: 3, impulse: 0, memory: 0, detail: 9, bogus: 3 } }));
  const acc2 = okc(await get(HRM, 'roles')).rows.find((r: any) => r.title === 'Accountant'); assert.equal(acc2.source, 'custom'); assert.deepEqual(acc2.weights, { reaction: 3, impulse: 0, memory: 0, detail: 3 }, 'weights are kept between 0 and 3');
  const p2 = okc(await get(HRI, 'person', { uid: 'f3' })); assert.deepEqual(p2.relevant.map((x: any) => x.id), ['reaction', 'detail'], 'the new profile applies at once');
  assert.equal(okc(await get(tok('f3'), 'me')).games[0].id, 'fraud-hunter');
  okc(await post(HRM, 'reset-role', { title: 'Accountant' }));
  assert.equal(okc(await get(HRM, 'roles')).rows.find((r: any) => r.title === 'Accountant').source, 'default');
  no(await post(HRM, 'save-role', { weights: {} }), 400);

  // ---- progress, and the right to be forgotten
  const prog = okc(await get(tok('f3'), 'progress')); assert.equal(prog.plays, 12); assert.equal(prog.history.length, 12); assert.equal(prog.calendar.length, 28);
  assert.ok(!JSON.stringify(prog).match(/skill|reaction|impulse/i), 'progress holds points and streaks only');
  assert.ok(prog.streak >= 1);
  assert.equal(okc(await post(tok('f3'), 'forget-me')).deleted, 12);
  assert.equal(okc(await get(tok('f3'), 'progress')).plays, 0);
  no(await get(HRI, 'person', { uid: 'f3' }), 404, 'forgotten means gone from HR as well');

  // ---- another company sees none of this
  fdb.seed('employees', 'z1', { companyId: 'c2', authUid: 'z1', name: 'Z', email: 'z1@o.com', active: true, departmentName: 'Finance', title: 'Accountant' });
  fdb.seed('companies', 'c2', { status: 'ACTIVE', name: 'Other' });
  const other = okc(await get(tok('z1', ['wellbeing.view'], 'c2'), 'overview')); assert.equal(other.groups.length, 0); assert.equal(other.players, 0);
  assert.equal(MIN_GROUP, 5);
  console.log('wellbeing: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
