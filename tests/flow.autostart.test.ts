import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeFlow, __setMailer, __setNow } from '../api/_lib/flowApi.ts';
import { createApplication, normalizeApplicationInput } from '../api/_lib/recruitmentData.ts';
import { listItems } from '../api/_lib/pipelineApi.ts';
import { makeStep, type FlowStep } from '../shared/flowEngine.ts';

/**
 * Regression: an applicant who applied (or applied again) did not get the hiring flow, and "Score the resume" claimed a
 * score it never worked out. Now: applying again starts the flow, and the scoring step really scores (or says why it could not).
 */
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const sent: { to: string; subject: string }[] = [];
__setMailer(async (p) => { sent.push({ to: p.to, subject: p.subject }); return { ok: true }; });
__setNow(() => new Date());

const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']);
const post = (h: any, action: string, body: any = {}) => routeFlow({ method: 'POST', action, headers: h, body, query: {} }) as Promise<any>;
fdb.seed('employees', 'u_hr', { companyId: CID, authUid: 'u_hr', name: 'Priya HR', email: 'u_hr@acme.com', active: true, title: 'HR' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });

const apply = async (name: string, extra: Record<string, unknown> = {}, email = `${name.toLowerCase()}@mail.com`) => {
  const { value } = normalizeApplicationInput({ name, email, designation: 'Dev-OPs Engineer', experience: '3 years' });
  return createApplication(CID, { ...value!, ...extra } as any, 'MANUAL');
};
const runOf = async (appId: string) => (await listItems(CID, 'flowRun')).find((r) => r.applicationId === appId) as any;
const scoreNote = (run: any) => String((run.history || []).find((h: any) => /scored|score this/i.test(h.text))?.text || '');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // someone applied before any flow existed
  const early = await apply('Dana');
  assert.equal(await runOf(early.id), undefined, 'no flow yet, so no run');

  // publish: score the resume, email the candidate, offer, joining
  const steps: FlowStep[] = [];
  const add = (t: any, over: any = {}) => { steps.push(makeStep(t, steps, over)); };
  const hr = { ownerUid: 'u_hr', ownerName: 'Priya HR' };
  add('ai_score');
  add('email', { settings: { subject: 'Update on your application for {{position}}', body: 'Hi {{name}}, we received your application.' } });
  add('offer', hr); add('onboard', hr);
  const saved = await post(HR, 'flow-save', { name: 'Dev-OPs hiring', steps });
  assert.equal(saved.status, 200); assert.deepEqual(saved.json.problems, [], JSON.stringify(saved.json.problems));
  await wait(15);
  assert.equal((await post(HR, 'flow-activate', { note: 'v1' })).status, 200);
  await wait(15);

  // 1. Dana applies again with the same email: this is the case that used to do nothing
  const again = await apply('Dana');
  assert.equal(again.duplicate, true, 'same person and position is the same application');
  assert.equal(again.id, early.id);
  const dana = await runOf(early.id);
  assert.ok(dana, 'applying again after the flow was published starts the flow');
  assert.ok(sent.some((m) => m.to === 'dana@mail.com' && /Update on your application/.test(m.subject)), 'the automatic email went out');
  assert.equal(dana.stepId, steps[2].id, 'scored, emailed, now waiting at the offer step');

  // applying a third time does not start a second run or send a second email
  const before = sent.length;
  await apply('Dana');
  assert.equal((await listItems(CID, 'flowRun')).filter((r) => r.applicationId === early.id).length, 1);
  assert.equal(sent.length, before, 'no second email');

  // 2. A brand new applicant with enough information gets a real score, written in the history
  const eli = await apply('Eli', { totalExperienceYears: 6, employersCount: 2 });
  const eliRun = await runOf(eli.id);
  assert.ok(eliRun, 'new applicant starts the flow');
  assert.match(scoreNote(eliRun), /Resume scored \d+ out of 100/, scoreNote(eliRun));
  assert.ok(sent.some((m) => m.to === 'eli@mail.com'));

  // 3. Nothing to score from: the flow does not pretend, and does not block either
  const fay = await apply('Fay');
  const fayRun = await runOf(fay.id);
  assert.match(scoreNote(fayRun), /Could not score this applicant yet/, scoreNote(fayRun));
  assert.ok(!/Resume scored/.test(scoreNote(fayRun)), 'never says "scored" when there is no score');
  assert.equal(fayRun.stepId, steps[2].id, 'still moved on to the email and the offer step');
  assert.ok(sent.some((m) => m.to === 'fay@mail.com'));

  // 4. A resume link that cannot be read is explained, and the flow still moves on
  const gus = await apply('Gus', { resumeUrl: 'https://not-allowed.example.org/gus.pdf' });
  const gusRun = await runOf(gus.id);
  assert.ok(gusRun && gusRun.stepId === steps[2].id, 'an unreadable resume does not stop the flow');
  assert.match(scoreNote(gusRun), /Could not score this applicant yet|out of 100/, scoreNote(gusRun));

  console.log('flow.autostart OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
