/**
 * Performance 2: calibration, increments to payroll, goals as evidence, 360 feedback.
 * Run: npx tsx tests/pm2.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePm } from '../api/_lib/pmApi.ts';
import {
  DEFAULT_PM2, adjustmentProblem, aggregate360, bandFor, blendBehaviour, cleanConfig, distribution, incrementProblem, nextFirstOfMonth, nextIncStatus,
  panelProblem, scaleAmounts, suggestRating,
} from '../shared/pm2Engine.ts';

// ---------------------------------------------------------------- pure rules
{
  const b = DEFAULT_PM2.bands;
  assert.equal(bandFor(4.5, b), 'Outstanding');
  assert.equal(bandFor(4.49, b), 'Exceeds expectations');
  assert.equal(bandFor(1, b), 'Unsatisfactory');
  assert.equal(bandFor(null, b), 'Not scored');
  assert.match(cleanConfig({ bands: [{ name: 'A', min: 3 }, { name: 'B', min: 2 }] }).error!, /lowest band must start at 1/);
  assert.match(cleanConfig({ bands: [{ name: 'A', min: 4 }, { name: 'A', min: 1 }] }).error!, /same name/);
  assert.match(cleanConfig({ threeSixty: { minRaters: 2 } }).error!, /At least 3 raters/);
  assert.match(cleanConfig({ threeSixty: { peerSharePct: 80 } }).error!, /at most 50%/);
  const custom = cleanConfig({ bands: [{ name: 'Star', min: 4 }, { name: 'Core', min: 1 }], increments: [{ band: 'Star', minPct: 10, maxPct: 15 }, { band: 'Core', minPct: 3, maxPct: 6 }] });
  assert.ok(custom.config, 'a company can use its own band words and ranges');
  assert.equal(bandFor(4.2, custom.config!.bands), 'Star');
  assert.match(adjustmentProblem(6, 'a long enough reason')!, /between 1 and 5/);
  assert.match(adjustmentProblem(3, 'short')!, /reason/);
  assert.equal(adjustmentProblem(3, 'compared against the peer group'), null);
  assert.equal(incrementProblem(10, 'Meets expectations', DEFAULT_PM2.increments)!.includes('4% to 8%'), true, 'outside the range is refused');
  assert.equal(incrementProblem(6, 'Meets expectations', DEFAULT_PM2.increments), null);
  assert.deepEqual(scaleAmounts({ BASIC: 50000, HRA: 25000 }, 10), { BASIC: 55000, HRA: 27500 });
  assert.equal(nextFirstOfMonth('2026-11-20'), '2026-12-01');
  assert.equal(nextFirstOfMonth('2026-12-15'), '2027-01-01');
  assert.equal(nextFirstOfMonth('2026-12-01'), '2026-12-01');
  assert.equal(nextIncStatus('RECOMMENDED', 'HR_THEN_APPROVER', true, false).next, 'HR_APPROVED');
  assert.equal(nextIncStatus('RECOMMENDED', 'HR_ONLY', true, false).next, 'APPROVED');
  assert.ok(nextIncStatus('HR_APPROVED', 'HR_THEN_APPROVER', true, false).error, 'second step needs an approver');
  assert.equal(suggestRating(100), 5); assert.equal(suggestRating(0), 1); assert.equal(suggestRating(60), 3); assert.equal(suggestRating(null), null);
  const d = distribution([4.8, 3.6, 3.0, 3.0], b);
  assert.equal(d.find((x) => x.band === 'Meets expectations')!.pct, 50);
  assert.match(panelProblem('s', ['a', 'b'], DEFAULT_PM2.threeSixty)!, /at least 3/);
  assert.match(panelProblem('s', ['a', 'b', 's'], DEFAULT_PM2.threeSixty)!, /themselves/);
  assert.equal(panelProblem('s', ['a', 'b', 'c'], DEFAULT_PM2.threeSixty), null);
  const two = aggregate360([{ ratings: { own: 5 }, comment: 'great' }, { ratings: { own: 4 }, comment: 'good' }], 4, 3, ['own']);
  assert.equal(two.enough, false); assert.equal(two.average, null); assert.deepEqual(two.comments, [], 'nothing is shown below the minimum');
  const three = aggregate360([{ ratings: { own: 5, com: 'NO' }, comment: 'a' }, { ratings: { own: 4, com: 3 }, comment: 'b' }, { ratings: { own: 3, com: 3 }, comment: '' }], 4, 3, ['own', 'com']);
  assert.equal(three.enough, true); assert.equal(three.byCompetency[0].average, 4);
  assert.equal(three.byCompetency[1].average, null, 'a competency rated by fewer than the minimum shows no average (not-observed cannot expose others)');
  assert.equal(three.comments.length, 2);
  assert.equal(blendBehaviour(4, 2, 25), 3.5);
  assert.equal(blendBehaviour(4, null, 25), 4); assert.equal(blendBehaviour(null, 3, 25), null);
}

// ---------------------------------------------------------------- the app
const fdb: any = new FakeFirestore();
fdb.read = (n: string, id: string) => fdb.all(n).find((d: any) => d.id === id);
fdb.count = (n: string) => fdb.all(n).length;
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1'; const Q = '2026-Q3';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['pm.manage', 'payroll.manage']); const AP = tok('u_ap', ['pm.approve']); const BOSS = tok('u_boss');
const A = tok('u_a'); const B = tok('u_b'); const D = tok('u_d'); const E = tok('u_e'); const F = tok('u_f'); const G = tok('u_g');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePm({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => { assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`); return r.json; };
const no = (r: any, status: number, msg = '') => assert.equal(r.status, status, `${msg} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, dept: string, perms: string[] = []) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title: 'Staff', perms });
emp('u_hr', 'Neha HR', 'HR', ['pm.manage', 'payroll.manage']); emp('u_ap', 'Ajay Founder', 'Management', ['pm.approve']); emp('u_boss', 'Rahul', 'Design');
['u_a:Priya', 'u_b:Bilal', 'u_d:Dev', 'u_e:Esha', 'u_f:Farid', 'u_g:Gita'].forEach((x) => { const [i, n] = x.split(':'); emp(i, n, 'Design'); });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const mgr = (uid: string, m: string) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: m });
['u_a', 'u_b', 'u_d', 'u_e', 'u_f', 'u_g'].forEach((u) => mgr(u, 'u_boss')); mgr('u_boss', 'u_ap'); mgr('u_hr', 'u_ap');

const review = (uid: string, name: string, overall: number, behaviour: number) =>
  fdb.seed('pmReviews', `${CID}_${Q}_${uid}`, { id: `${CID}_${Q}_${uid}`, companyId: CID, uid, name, cycleKey: Q, status: 'HR', score: { overall, behaviour, band: '' } });
review('u_a', 'Priya', 4.7, 4); review('u_b', 'Bilal', 3.6, 3.5); review('u_d', 'Dev', 3.0, 3); review('u_e', 'Esha', 2.0, 2);

// payroll: one salary structure to revise
fdb.seed('payrollSettings', CID, { components: [{ id: 'BASIC', name: 'Basic', kind: 'EARNING', active: true }, { id: 'HRA', name: 'HRA', kind: 'EARNING', active: true }] });
fdb.seed('payrollStructures', `${CID}_u_b`, { companyId: CID, uid: 'u_b', amounts: { BASIC: 50000, HRA: 25000 }, state: 'MH', pfApplicable: true, esicApplicable: false, pfOnActualWage: false });

(async () => {
  // ---- permissions: employees cannot see calibration or the config
  no(await get(A, 'p2-cal', { cycle: Q }), 403, 'an employee cannot open calibration');
  no(await get(BOSS, 'p2-config'), 403, 'a manager cannot read increment rules');
  no(await post(AP, 'p2-config-save', { config: {} }), 403, 'only HR saves settings');

  // ---- settings are validated and versioned; the cycle freezes a snapshot
  const bad1 = await post(HR, 'p2-config-save', { config: { bands: [{ name: 'X', min: 3 }, { name: 'Y', min: 2 }] } });
  no(bad1, 400, 'invalid bands are refused');
  const saved = okc(await post(HR, 'p2-config-save', { config: DEFAULT_PM2 }));
  assert.equal(saved.version, 1);
  no(await post(AP, 'p2-cal-open', { cycle: Q }), 403, 'only HR opens calibration');
  okc(await post(HR, 'p2-cal-open', { cycle: Q }));
  const custom = { ...DEFAULT_PM2, bands: [{ name: 'Star', min: 4.5 }, { name: 'Strong', min: 3.5 }, { name: 'Core', min: 2.5 }, { name: 'Low', min: 1 }], increments: [{ band: 'Star', minPct: 10, maxPct: 15 }, { band: 'Strong', minPct: 6, maxPct: 10 }, { band: 'Core', minPct: 3, maxPct: 6 }, { band: 'Low', minPct: 0, maxPct: 0 }] };
  assert.equal(okc(await post(HR, 'p2-config-save', { config: custom })).version, 2);
  let cal = okc(await get(AP, 'p2-cal', { cycle: Q }));
  assert.equal(cal.version, 1, 'a later settings change does NOT touch the open cycle');
  assert.equal(cal.rows.find((r: any) => r.uid === 'u_a').band, 'Outstanding', 'the cycle still uses its frozen band words');
  assert.equal(cal.rows.length, 4);

  // ---- calibration: reason required, original kept, locked when final
  no(await post(AP, 'p2-cal-adjust', { cycle: Q, uid: 'u_d', to: 3.6, reason: 'short' }), 400, 'a reason is required');
  no(await post(AP, 'p2-cal-adjust', { cycle: Q, uid: 'u_ap', to: 3, reason: 'not in this cycle at all' }), 404);
  okc(await post(AP, 'p2-cal-adjust', { cycle: Q, uid: 'u_d', to: 3.6, reason: 'Carried the migration; peers at this level rated higher' }));
  cal = okc(await get(AP, 'p2-cal', { cycle: Q }));
  const dev = cal.rows.find((r: any) => r.uid === 'u_d');
  assert.equal(dev.original, 3.0, 'the original score is never overwritten');
  assert.equal(dev.calibrated, 3.6); assert.equal(dev.band, 'Exceeds expectations'); assert.equal(dev.originalBand, 'Meets expectations');
  assert.equal(cal.changes.length, 1);
  assert.notDeepEqual(cal.before, cal.after, 'distribution before and after is shown');
  const rv = fdb.read('pmReviews', `${CID}_${Q}_u_d`);
  assert.equal(rv.score.overall, 3.0, 'the review record itself is untouched');
  no(await post(HR, 'p2-inc-recommend', { cycle: Q, uid: 'u_b', pct: 8, reason: 'strong year overall' }), 409, 'no increments before calibration is final');
  no(await post(HR, 'p2-cal-amend', { cycle: Q, reason: 'too short' }), 400);
  okc(await post(HR, 'p2-cal-amend', { cycle: Q, reason: 'Board changed the band words before calibration ended' }));
  const am = okc(await get(AP, 'p2-cal', { cycle: Q }));
  assert.equal(am.version, 2, 'an audited amendment moves the cycle to the new version');
  assert.equal(am.rows.find((r: any) => r.uid === 'u_d').band, 'Strong', 'and the new band words apply');
  okc(await post(AP, 'p2-cal-finalise', { cycle: Q }));
  no(await post(AP, 'p2-cal-adjust', { cycle: Q, uid: 'u_d', to: 4, reason: 'trying after it was locked' }), 409, 'final means locked');

  // ---- increments: range per band, approvals, payroll hand-off
  const strongRange = 'between 6 and 10';
  const over = await post(BOSS, 'p2-inc-recommend', { cycle: Q, uid: 'u_b', pct: 15, reason: 'wants to keep her' });
  no(over, 400, 'outside the band range is refused'); assert.match(over.json.error, /6% to 10%/, strongRange);
  no(await post(A, 'p2-inc-recommend', { cycle: Q, uid: 'u_b', pct: 8, reason: 'trying for a colleague' }), 403, 'only manager or HR');
  const mine = await get(A, 'p2-inc', { cycle: Q }); assert.equal(mine.json.rows.length, 0, 'an employee sees no increment rows');
  okc(await post(BOSS, 'p2-inc-recommend', { cycle: Q, uid: 'u_b', pct: 8, reason: 'Strong year and took on the lead role' }));
  const inc = okc(await get(HR, 'p2-inc', { cycle: Q })).rows.find((r: any) => r.uid === 'u_b').proposal;
  no(await post(HR, 'p2-inc-send', { id: inc.id }), 409, 'not approved yet');
  no(await post(AP, 'p2-inc-decide', { id: inc.id, decision: 'approve' }), 403, 'HR approves first');
  okc(await post(HR, 'p2-inc-decide', { id: inc.id, decision: 'approve' }));
  no(await post(HR, 'p2-inc-decide', { id: inc.id, decision: 'approve' }), 403, 'the second approval must be someone else');
  okc(await post(AP, 'p2-inc-decide', { id: inc.id, decision: 'approve' }));
  no(await post(AP, 'p2-inc-send', { id: inc.id }), 403, 'sending needs payroll permission');
  no(await post(HR, 'p2-inc-send', { id: inc.id, effectiveFrom: '2026-12-15' }), 400, 'must be the first of a month');
  const sent = okc(await post(HR, 'p2-inc-send', { id: inc.id, effectiveFrom: '2026-12-01' }));
  const rev = fdb.read('payrollRevisions', sent.revisionId);
  assert.equal(rev.status, 'SCHEDULED', 'payroll gets a PROPOSAL, never an applied change');
  assert.deepEqual(rev.amounts, { BASIC: 54000, HRA: 27000 }); assert.equal(rev.annualCtc, 972000);
  assert.equal(fdb.read('payrollStructures', `${CID}_u_b`).amounts.BASIC, 50000, 'the live salary is unchanged until payroll applies it');
  assert.equal(okc(await post(HR, 'p2-inc-send', { id: inc.id })).already, true, 'sending twice does not create a second revision');
  assert.equal(fdb.count('payrollRevisions'), 1);
  // a person with no salary in payroll
  okc(await post(HR, 'p2-inc-recommend', { cycle: Q, uid: 'u_d', pct: 8, reason: 'Calibrated up after review' }));
  const inc2 = okc(await get(HR, 'p2-inc', { cycle: Q })).rows.find((r: any) => r.uid === 'u_d').proposal;
  okc(await post(AP, 'p2-inc-decide', { id: inc2.id, decision: 'reject', note: 'Budget frozen for this team' }));
  assert.equal(okc(await get(HR, 'p2-inc', { cycle: Q })).rows.find((r: any) => r.uid === 'u_d').proposal.status, 'REJECTED');

  // ---- goals as evidence
  fdb.seed('hrbpItems', 'o1', { id: 'o1', companyId: CID, kind: 'okr', level: 'INDIVIDUAL', quarter: Q, ownerUid: 'u_a', title: 'Ship redesign', state: 'ACTIVE', keyResults: [{ id: 'k1', title: 'pages', start: 0, target: 10, current: 6, weight: 1 }] });
  const g = okc(await get(BOSS, 'p2-goals', { cycle: Q, uid: 'u_a' }));
  assert.equal(g.averageProgress, 60); assert.equal(g.suggested, 3); assert.equal(g.confirmed, null, 'a suggestion is not a rating');
  no(await get(B, 'p2-goals', { cycle: Q, uid: 'u_a' }), 403, 'a colleague cannot read someone else\'s goals evidence');
  no(await post(A, 'p2-goals-confirm', { cycle: Q, uid: 'u_a', rating: 5 }), 403, 'you cannot confirm your own');
  no(await post(BOSS, 'p2-goals-confirm', { cycle: Q, uid: 'u_a', rating: 5 }), 400, 'differing from the suggestion needs a reason');
  okc(await post(BOSS, 'p2-goals-confirm', { cycle: Q, uid: 'u_a', rating: 4, note: 'Quality was above the numbers' }));
  assert.equal(okc(await get(A, 'p2-goals', { cycle: Q })).confirmed.rating, 4);

  // ---- 360
  no(await post(A, 'p2-360-nominate', { cycle: Q, raters: ['u_b', 'u_d'] }), 400, 'fewer than the minimum is refused');
  no(await post(A, 'p2-360-nominate', { cycle: Q, raters: ['u_b', 'u_d', 'u_a'] }), 400, 'self is refused');
  no(await post(B, 'p2-360-nominate', { cycle: Q, uid: 'u_a', raters: ['u_b', 'u_d', 'u_e'] }), 403, 'a colleague cannot choose raters for you');
  okc(await post(A, 'p2-360-nominate', { cycle: Q, raters: ['u_b', 'u_d', 'u_e', 'u_f'] }));
  const pid = `${CID}_${Q}_u_a`;
  no(await post(B, 'p2-360-give', { id: pid, ratings: { own: 4 } }), 409, 'nothing can be given before HR approves');
  no(await post(A, 'p2-360-approve', { id: pid }), 403, 'you cannot approve your own reviewers');
  okc(await post(HR, 'p2-360-approve', { id: pid }));
  assert.equal(okc(await get(B, 'p2-360-todo')).items.length, 1);
  assert.equal(okc(await get(G, 'p2-360-todo')).items.length, 0, 'someone not chosen sees nothing');
  no(await post(G, 'p2-360-give', { id: pid, ratings: { own: 4 } }), 404, 'someone not chosen cannot answer');
  no(await post(B, 'p2-360-give', { id: pid, ratings: { own: 9 } }), 400);
  okc(await post(B, 'p2-360-give', { id: pid, ratings: { own: 5, com: 4 }, comment: 'Always helps the team' }));
  no(await post(B, 'p2-360-give', { id: pid, ratings: { own: 1 } }), 409, 'feedback is final once sent');
  okc(await post(D, 'p2-360-give', { id: pid, ratings: { own: 4, com: 'NO' } }));
  let res = okc(await get(BOSS, 'p2-360-result', { cycle: Q, uid: 'u_a' }));
  assert.equal(res.enough, false); assert.equal(res.average, null); assert.deepEqual(res.comments, []);
  assert.match(res.waiting, /2 of 4/);
  okc(await post(E, 'p2-360-give', { id: pid, ratings: { own: 3, com: 3 }, comment: 'Needs to speak up in meetings' }));
  res = okc(await get(BOSS, 'p2-360-result', { cycle: Q, uid: 'u_a' }));
  assert.equal(res.enough, true); assert.equal(res.average, 4, 'own: (5+4+3)/3 = 4; com has only 2 numeric answers so it is hidden');
  assert.equal(res.byCompetency.find((x: any) => x.id === 'com').average, null);
  assert.equal(res.comments.length, 2);
  assert.ok(!JSON.stringify(res).includes('u_b') && !JSON.stringify(res).includes('Bilal'), 'rater identities never appear in a result');
  assert.equal(res.blend.managerBehaviour, 4); assert.equal(res.blend.suggested, 4, 'peers average 4 and manager 4: unchanged');
  // the employee waits for release
  assert.equal(okc(await get(A, 'p2-360-result', { cycle: Q })).available, false);
  okc(await post(HR, 'p2-360-release', { id: pid }));
  const mineRes = okc(await get(A, 'p2-360-result', { cycle: Q }));
  assert.equal(mineRes.available, true); assert.equal(mineRes.blend, null, 'the employee does not get the manager\'s score');
  assert.ok(!JSON.stringify(mineRes).includes('Bilal'));
  const panelsA = okc(await get(A, 'p2-360-panels', { cycle: Q })).rows[0];
  assert.equal(panelsA.responded, 3); assert.ok(panelsA.nominated, 'the person who chose them can see the list they chose');
  const panelsBoss = okc(await get(BOSS, 'p2-360-panels', { cycle: Q })).rows[0];
  assert.equal(panelsBoss.nominated, undefined, 'a manager who did not choose them does not get names');
  // audit of identities: HR only, reason, logged
  no(await post(BOSS, 'p2-360-audit', { id: pid, reason: 'curious who said it' }), 403, 'managers cannot see identities');
  no(await post(HR, 'p2-360-audit', { id: pid, reason: 'short' }), 400);
  const aud = okc(await post(HR, 'p2-360-audit', { id: pid, reason: 'Complaint about an abusive comment' }));
  assert.ok(aud.raters.some((r: any) => r.name === 'Bilal' && r.responded));
  assert.ok(fdb.all('pmLog').some((l: any) => l.action === 'P2_360_IDENTITIES_VIEWED'), 'looking at identities is on the audit trail');
  assert.ok(!fdb.all('pmLog').some((l: any) => l.action.includes('360_GIVEN')), 'answering is not on the audit trail');

  // ---- tenant isolation
  const OTHER = tok('x1', ['pm.manage', 'pm.approve'], 'c2');
  fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true });
  fdb.seed('companies', 'c2', { status: 'ACTIVE', name: 'Other' });
  const o = okc(await get(OTHER, 'p2-cal', { cycle: Q }));
  assert.equal(o.rows.length, 0, 'another company sees none of these reviews');
  console.log('pm2: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
