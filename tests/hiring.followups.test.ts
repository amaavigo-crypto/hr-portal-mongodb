/** Automatic follow-ups: off by default, working hours only, once a day per person per task, and company-scoped. */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { runFollowUps, runFollowUpsAll, __setFollowUpMailer, __setFollowUpNow } from '../api/_lib/followUpApi.ts';
import { isWorkingTime, cleanFollowUpSettings } from '../shared/followUps.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const sent: any[] = [];
__setFollowUpMailer(async (p) => { await Promise.resolve(); sent.push(p); return { success: true, provider: 'test' }; });
let now = new Date('2026-03-04T06:00:00Z'); // Wednesday, 11:30 am India time
__setFollowUpNow(() => now);
const call = (headers: any, action: string, method = 'GET', body?: any) => routeHiring({ method, action, query: {}, body, headers });
const HR = tok('hr', ['app.manage']);

async function main() {
  assert.equal(isWorkingTime(new Date('2026-03-04T06:00:00Z')), true);
  assert.equal(isWorkingTime(new Date('2026-03-04T14:00:00Z')), false, '7:30 pm');
  assert.equal(isWorkingTime(new Date('2026-03-07T06:00:00Z')), false, 'Saturday');
  assert.equal(cleanFollowUpSettings({ rules: { feedback: { after: 9999 } } }).rules.feedback.after, 72);

  fdb.seed('companies', 'c1', { name: 'Acme', status: 'ACTIVE' });
  const person = (uid: string, extra: any = {}, cid = 'c1') => fdb.seed('employees', uid, { companyId: cid, authUid: uid, name: uid, email: `${uid}@a.com`, active: true, perms: [], roleIds: [], ...extra });
  person('hr', { roleIds: ['c1_hr-head'] }); person('int1'); person('int2'); person('boss', { perms: ['req.founder_decide'] });
  fdb.seed('applications', 'a1', { id: 'a1', companyId: 'c1', name: 'Ravi', email: 'ravi@mail.com', designation: 'Developer', status: 'Interview Scheduled', createdAt: '2026-03-01T00:00:00Z' });
  fdb.seed('hiringItems', 'iv1', { id: 'iv1', companyId: 'c1', kind: 'interview', applicationId: 'a1', candidateName: 'Ravi', positionTitle: 'Developer', round: 'Round 1', status: 'SCHEDULED', startIso: '2026-03-03T05:00:00Z', durationMinutes: 45,
    panel: [{ uid: 'int1' }, { uid: 'int2' }], scorecards: [{ interviewerId: 'int2' }] });
  fdb.seed('hiringItems', 'o1', { id: 'o1', companyId: 'c1', kind: 'offer', applicationId: 'a1', candidateName: 'Ravi', designation: 'Developer', status: 'PENDING_FOUNDER', updatedAt: '2026-03-01T00:00:00Z', history: [{ action: 'submit', at: '2026-03-01T00:00:00Z' }] });

  // only hiring managers see or change it, and it starts off
  assert.equal((await call(tok('int1', []), 'followup-state')).status, 403);
  const first = (await call(HR, 'followup-state')).json as any;
  assert.equal(first.settings.enabled, false);
  assert.deepEqual(first.next.map((n: any) => `${n.ruleId}:${n.toName}`).sort(), ['feedback:int1', 'offer:boss']);
  await runFollowUps('c1'); await runFollowUpsAll(); await call(HR, 'followup-run', 'POST', {});
  assert.equal(sent.length, 0, 'nothing is sent while off');

  assert.equal((await call(HR, 'followup-save', 'POST', { enabled: true })).status, 200);
  now = new Date('2026-03-04T16:00:00Z');
  await runFollowUpsAll();
  assert.equal(sent.length, 0, 'nothing outside working hours');
  now = new Date('2026-03-04T06:00:00Z');
  // two engines at once still send once each
  await Promise.all([runFollowUps('c1'), runFollowUps('c1')]);
  await runFollowUpsAll();
  assert.deepEqual(sent.map((m) => m.to).sort(), ['boss@a.com', 'int1@a.com']);
  now = new Date('2026-03-05T06:00:00Z');
  await runFollowUps('c1');
  assert.equal(sent.length, 4, 'again the next day');

  // after two reminders the Head of HR hears about it, when that rule is on
  await call(HR, 'followup-save', 'POST', { rules: { escalate: { on: true, after: 2 } } });
  sent.length = 0; now = new Date('2026-03-06T06:00:00Z');
  await runFollowUps('c1');
  assert.equal(sent.filter((m) => m.to === 'hr@a.com').length, 2);

  // the record shows who and why
  const activity = (await call(HR, 'flow-activity')).json as any;
  assert.ok(activity.items.some((i: any) => /Reminder sent to int1: Feedback for Round 1/.test(i.text)));

  // pause stops everything; finished work is not chased; other companies see nothing
  await call(HR, 'followup-save', 'POST', { enabled: false });
  sent.length = 0; now = new Date('2026-03-09T06:00:00Z');
  await runFollowUpsAll();
  assert.equal(sent.length, 0);
  fdb.seed('companies', 'c2', { name: 'Other', status: 'ACTIVE' });
  const other = (await call(tok('x', ['app.manage'], 'c2'), 'followup-state')).json as any;
  assert.equal(other.next.length + other.recent.length, 0);

  console.log('hiring follow-up tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
