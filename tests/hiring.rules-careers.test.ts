/** Quick rules and the public careers page. */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { createApplication, deleteApplication, normalizeApplicationInput } from '../api/_lib/recruitmentData.ts';
import { __setRuleMailer } from '../api/_lib/quickRulesApi.ts';
import { __setCareersNow } from '../api/_lib/careersPageApi.ts';
import { loadStoredResume } from '../api/_lib/resumeFiles.ts';
import { cleanRule } from '../shared/quickRules.ts';

process.env.STORAGE_URL_SECRET = 'test-secret';
process.env.LEGACY_OPEN_STORAGE = 'true'; // must not open resume files
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tok('hr', ['app.manage']);
const OTHER = tok('x', ['app.manage'], 'c2');
const sent: any[] = [];
__setRuleMailer(async (p) => { sent.push(p); return { success: true, provider: 'test' }; });
const call = (headers: any, action: string, method = 'GET', body?: any, query: any = {}) => routeHiring({ method, action, query, body, headers });
const json = async (p: Promise<{ json: any }>) => (await p).json;
const apply = async (name: string, extra: any = {}, source: any = 'MANUAL') => createApplication('c1', normalizeApplicationInput({ name, email: `${name}@mail.com`, designation: 'Developer', ...extra }).value!, source);
const apps = () => fdb.all('applications');

async function main() {
  fdb.seed('companies', 'c1', { name: 'Acme Labs', status: 'ACTIVE' });
  fdb.seed('companies', 'c2', { name: 'Other', status: 'ACTIVE' });
  fdb.seed('employees', 'hr', { companyId: 'c1', authUid: 'hr', name: 'Hema', email: 'hr@a.com', active: true, roleIds: ['c1_hr-head'] });
  fdb.seed('requisitions', 'r1', { id: 'r1', companyId: 'c1', status: 'JOB_OPEN', positionTitle: 'Developer', departmentName: 'Tech', keySkills: 'react, node', ctcMaxLpa: 20, minExperienceYears: 2, maxExperienceYears: 6, jd: { text: 'Build things.' } });
  fdb.seed('requisitions', 'r2', { id: 'r2', companyId: 'c1', status: 'DRAFT', positionTitle: 'Secret role' });

  // ---- quick rules
  assert.ok(cleanRule({ name: 'x', actions: [{ type: 'reject' }] }).error, 'there is no reject action');
  const rule = { name: 'Experienced', conditions: [{ field: 'experience', op: 'atLeast', value: '5' }], actions: [{ type: 'tag', tag: 'Experienced' }, { type: 'ack', subject: 'Got it, {name}', message: 'About {job} at {company}' }] };
  assert.equal((await call(tok('e', []), 'qrule-list')).status, 403);
  await apply('early', { experience: '9 years' });
  const dry = await json(call(HR, 'qrule-test', 'POST', rule));
  assert.equal(dry.matched, 1);
  assert.equal(sent.length, 0, 'a test run sends nothing');
  assert.equal(apps()[0].tags, undefined, 'and changes nothing');

  const draft = await json(call(HR, 'qrule-save', 'POST', rule));
  assert.equal(draft.status, 'DRAFT');
  await apply('whiledraft', { experience: '8' });
  assert.equal(sent.length, 0, 'a draft does nothing');
  await call(HR, 'qrule-save', 'POST', { ...rule, id: draft.id, turnOn: true });
  await new Promise((r) => setTimeout(r, 5));
  const a = await apply('senior', { experience: '7 years' });
  await apply('junior', { experience: '1' });
  await apply('imported', { experience: '12' }, 'CSV');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Got it, Senior');
  assert.deepEqual(apps().find((x) => x.id === a.id)!.tags, ['Experienced']);
  const { quickRulesHook } = await import('../api/_lib/quickRulesApi.ts');
  await Promise.all([quickRulesHook('c1', a.id), quickRulesHook('c1', a.id)]);
  assert.equal(sent.length, 1, 'once per candidate');
  assert.equal(apps().find((x) => x.id === a.id)!.status, 'New Applicant');
  const listed = await json(call(HR, 'qrule-list'));
  assert.equal(listed.recent.length, 1);
  assert.equal((await call(OTHER, 'qrule-switch', 'POST', { id: draft.id, on: false })).status, 404);
  await call(HR, 'qrule-switch', 'POST', { id: draft.id, on: false });
  await apply('afteroff', { experience: '10' });
  assert.equal(sent.length, 1);

  // ---- careers page: nothing public until published
  const pub = (slug: string, ip = '1.1.1.1') => call({ 'x-real-ip': ip }, 'careers-public-get', 'GET', undefined, { slug });
  assert.equal((await pub('acme-labs')).status, 404);
  assert.equal((await call(tok('e', []), 'careers-save', 'POST', { published: true })).status, 403);
  assert.equal((await call(HR, 'careers-save', 'POST', { published: true, slug: 'acme-labs' })).status, 200);
  assert.equal((await call(OTHER, 'careers-save', 'POST', { slug: 'acme-labs' })).status, 409, 'an address belongs to one company');
  const page = (await pub('acme-labs')).json as any;
  assert.deepEqual(page.jobs.map((j: any) => j.title), ['Developer']);
  assert.equal(/ctc|budget|20/i.test(JSON.stringify(page.jobs)), false, 'no salary band in public data');

  let clock = Date.now();
  __setCareersNow(() => clock);
  const fresh = ((await pub('acme-labs')).json as any).formToken;
  const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(1_200_000)).toString('base64');
  const form = (over: any = {}) => ({ slug: 'acme-labs', jobId: 'r1', name: 'Nina Rao', email: 'nina@mail.com', phone: '9876543210', expectedCtcLpa: 12, consent: true, formToken: fresh, source: 'Naukri Board!', website: '', resume: { name: 'cv.pdf', data: pdf }, ...over });
  let n = 0;
  const submit = (body: any) => call({ 'x-real-ip': `2.2.2.${++n}` }, 'careers-public-apply', 'POST', body);
  assert.equal((await submit(form())).status, 400, 'too quick');
  clock += 10_000;
  assert.equal((await submit(form({ consent: false }))).status, 400);
  assert.equal((await submit(form({ jobId: 'r2' }))).status, 409);
  assert.equal((await submit(form({ formToken: `${clock - 10000}.forged` }))).status, 400);
  assert.equal((await submit(form({ resume: { name: 'cv.pdf', data: Buffer.from('<html>').toString('base64') } }))).status, 400);
  assert.equal((await submit(form({ resume: { name: 'cv.exe', data: pdf } }))).status, 400);
  assert.equal((await submit(form({ resume: { name: 'cv.pdf', data: Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64') } }))).status, 413);
  const before = apps().length;
  assert.equal((await submit(form({ website: 'http://spam' }))).status, 200);
  assert.equal(apps().length, before, 'a robot is not stored');

  const first = await submit(form());
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const nina = apps().find((x) => x.email === 'nina@mail.com')!;
  assert.equal(nina.companyId, 'c1');
  assert.equal(nina.source, 'CAREERS');
  assert.equal(nina.sourceLabel, 'naukri-board');
  assert.ok(nina.consent.text.includes('12 months'));
  const stored = await loadStoredResume(nina.resumeUrl);
  assert.equal(stored!.buf.toString('base64'), pdf, 'a file stored in parts reads back whole');
  const q = Object.fromEntries(new URLSearchParams(nina.resumeUrl.split('?')[1]));
  assert.ok(((await call({}, 'careers-resume-file', 'GET', undefined, q)).json as any).__file);
  assert.equal((await call({}, 'careers-resume-file', 'GET', undefined, { ...q, t: 'a'.repeat(40) })).status, 403);

  // someone else typing the same email cannot overwrite the first application, and is told nothing
  const again = await submit(form({ phone: '1111111111' }));
  assert.deepEqual(again.json, first.json);
  assert.equal(apps().find((x) => x.id === nina.id)!.mobile, '9876543210');

  const state = await json(call(HR, 'careers-state'));
  assert.equal(state.jobs[0].bySource['naukri-board'], 1);
  assert.equal(((await json(call(OTHER, 'careers-state'))).total), 0);

  // per-address limit
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await call({ 'x-forwarded-for': `6.6.6.${i}, 7.7.7.7` }, 'careers-public-apply', 'POST', form({ consent: false }))).status);
  assert.equal(codes[6], 429, 'a spoofed first address does not get round the limit');

  await deleteApplication('c1', nina.id);
  assert.equal(await loadStoredResume(nina.resumeUrl), null, 'deleting an application deletes its resume');
  await call(HR, 'careers-save', 'POST', { published: false });
  assert.equal((await pub('acme-labs', '3.3.3.3')).status, 404);
  console.log('quick rules and careers page tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
