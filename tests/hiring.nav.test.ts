import assert from 'node:assert/strict';
import { hiringTabs, isHiringModule, tabOfModule } from '../src/components/hiring/shell/hiringNav.ts';
import { awaitingMyFeedback, upcomingInterviews } from '../src/components/hiring/shell/homeData.ts';

const keys = (a: Parameters<typeof hiringTabs>[0]) => hiringTabs(a).map((t) => t.key);
const pages = (a: Parameters<typeof hiringTabs>[0]) => hiringTabs(a).flatMap((t) => t.pages.map((p) => p.module));

// ---- who sees what
assert.deepEqual(keys({ talent: false, canRequest: false, manageFlows: false }), ['home'], 'every employee gets Home');
assert.deepEqual(pages({ talent: false, canRequest: false, manageFlows: false }), ['talent-hiring', 'my-hiring'], 'tasks, referrals and interviews stay open to everyone');
assert.deepEqual(keys({ talent: false, canRequest: true, manageFlows: false }), ['home', 'jobs'], 'a department head also gets Jobs');
assert.deepEqual(keys({ talent: true, canRequest: true, manageFlows: true }), ['home', 'jobs', 'candidates', 'onboarding', 'automation']);
assert.deepEqual(keys({ talent: true, canRequest: false, manageFlows: false }), ['home', 'jobs', 'candidates', 'onboarding'], 'no Automation without the right to manage flows');
assert.ok(!pages({ talent: false, canRequest: true, manageFlows: false }).includes('talent-acquisition-overview'), 'reports need the Talent module');

// ---- every old screen still has a home
for (const [m, t] of [['talent-hiring', 'home'], ['talent-acquisition', 'home'], ['talent-acquisition-overview', 'home'], ['my-hiring', 'home'],
  ['talent-acquisition-requisitions', 'jobs'], ['talent-acquisition-pipeline', 'candidates'], ['talent-acquisition-applications', 'candidates'],
  ['talent-acquisition-onboarding', 'onboarding'], ['hiring-automation', 'automation']] as const) {
  assert.ok(isHiringModule(m), m);
  assert.equal(tabOfModule(m), t, m);
}
for (const m of ['home', 'payroll', 'tasks', 'hrbp', 'document-version-control']) assert.ok(!isHiringModule(m), m);

// ---- Home interview lists
const now = Date.parse('2026-11-27T10:00:00Z');
const iv = (id: string, startIso: string, extra: object = {}) => ({ id, startIso, status: 'SCHEDULED', candidateName: 'A', round: 'R1', ...extra });
const list = [
  iv('later', '2026-11-30T10:00:00.000Z'), iv('soon', '2026-11-28T10:00:00.000Z'), iv('far', '2026-12-20T10:00:00.000Z'),
  iv('cancelled', '2026-11-28T11:00:00.000Z', { status: 'CANCELLED' }),
  iv('owed', '2026-11-26T10:00:00.000Z', { iAmOnPanel: true, iSubmitted: false }),
  iv('sent', '2026-11-26T11:00:00.000Z', { iAmOnPanel: true, iSubmitted: true }),
  iv('notmine', '2026-11-26T12:00:00.000Z', { iAmOnPanel: false }),
];
assert.deepEqual(upcomingInterviews(list, now).map((i) => i.id), ['soon', 'later']);
assert.deepEqual(awaitingMyFeedback(list, now).map((i) => i.id), ['owed']);

console.log('hiring navigation tests passed');
