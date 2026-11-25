import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHrbp } from '../api/_lib/hrbpApi.ts';
import { routeTasks } from '../api/_lib/taskApi.ts';
import {
  addDays, amountInText, briefProblem, checkPlan, cleanBrief, cleanSkills, costPlan, dailyCost, healthChecks, hidePersonalCost, inr, inrShort, matchTeam, normSkill,
  skillFit, suggestSkills, swapAssignment, workingDays, weeksOf, type Brief, type Candidate,
} from '../shared/projectPlanner.ts';

// ------------------------------------------------------------------ pure parts

assert.equal(inr(1462400), '₹14,62,400');
assert.equal(inr(-737600), '−₹7,37,600');
assert.equal(inr(999), '₹999');
assert.equal(inrShort(1462400), '₹14.62L');
assert.equal(inrShort(25_000_000), '₹2.50Cr');
assert.equal(workingDays('2026-11-23', '2026-11-29'), 5, 'Mon to Sun is 5 working days');
assert.equal(workingDays('2026-11-28', '2026-11-29'), 0);
assert.equal(weeksOf('2026-12-01', '2027-02-23'), 13, '61 working days');
assert.equal(dailyCost(1_300_000), 5000);
assert.equal(dailyCost(null), null);

// money read from a document must be written in it
const doc = 'Total budget: 18 lakh. Hosting about Rs 40,000 per year. Kick-off 1 Dec 2026. Contract value 22,00,000.';
assert.ok(amountInText(1_800_000, doc), '"18 lakh"');
assert.ok(amountInText(40_000, doc), '"40,000"');
assert.ok(amountInText(2_200_000, doc), 'Indian grouping');
assert.ok(!amountInText(2_500_000, doc), 'a number that is not there');
assert.ok(!amountInText(180_000, doc), '18 lakh is not 1.8 lakh');
assert.ok(amountInText(15_000_000, 'Budget 1.5 crore'));
assert.ok(amountInText(1_800_000, 'Budget INR 1,800,000'));
assert.ok(amountInText(250_000, 'about 250k'));

const T = '2026-11-24';
const aiBrief = {
  name: 'ShopKart app', summary: 'A shopping app.', goals: ['Launch'], deliverables: ['Android app', 'iOS app'], startDate: '2026-12-01', endDate: '2027-02-23',
  budget: 1_800_000, clientPrice: 9_999_999, otherCosts: [{ label: 'Hosting', amount: 40_000 }, { label: 'Made up', amount: 77_777 }],
  roles: [{ title: 'Mobile developer', skills: ['React Native', 'REST APIs'], count: 2, allocation: 100 }, { title: 'Designer', skills: ['Figma', 'UI design'], count: 1, allocation: 63 }],
};
let b = cleanBrief(aiBrief, {}, doc, T);
assert.equal(b.budget, 1_800_000, 'kept: the document says 18 lakh');
assert.equal(b.clientPrice, null, 'dropped: 99,99,999 is not in the document');
assert.deepEqual(b.otherCosts, [{ label: 'Hosting', amount: 40_000 }], 'an invented cost is dropped');
assert.ok(b.warnings.some((w) => /client price/.test(w)) && b.warnings.some((w) => /Made up/.test(w)));
assert.equal(b.roles[1].allocation, 60, 'allocations are rounded to 10%');
b = cleanBrief(aiBrief, { clientPrice: '22,00,000', budget: 2_000_000 }, doc, T);
assert.deepEqual([b.budget, b.clientPrice], [2_000_000, 2_200_000], 'what the person typed wins');
assert.equal(cleanBrief({ ...aiBrief, endDate: '2026-11-01' }, {}, doc, T).endDate, '', 'an end before the start is cleared');
assert.match(briefProblem(cleanBrief({ ...aiBrief, roles: [] }, {}, doc, T)), /role/);
assert.match(briefProblem(cleanBrief({ ...aiBrief, startDate: '' }, {}, doc, T)), /start date/);
assert.equal(briefProblem(b), '');

// skills
assert.equal(normSkill('RN'), 'react native');
assert.equal(normSkill(' Node '), 'node.js');
assert.deepEqual(cleanSkills(['React', { name: 'react', level: 3 }, '', 'x']).map((s) => [s.name, s.level]), [['react', 3]], 'duplicates merge at the higher level; junk dropped');
assert.ok(suggestSkills('React Native Developer', ['AWS Certified']).some((s) => s.name === 'React Native'));
assert.ok(suggestSkills('Accountant', [], ['GST']).some((s) => s.name === 'GST' && s.level === 1), 'training needs are level 1');
const role = { title: 'Mobile developer', skills: ['React Native', 'REST APIs'] };
const strong = skillFit(role, { title: 'Mobile Developer', skills: [{ name: 'React Native', level: 3 }, { name: 'REST APIs', level: 3 }], source: 'confirmed' });
const guessed = skillFit(role, { title: 'Mobile Developer', skills: [{ name: 'React Native', level: 3 }, { name: 'REST APIs', level: 3 }], source: 'suggested' });
const half = skillFit(role, { title: 'Analyst', skills: [{ name: 'React Native', level: 2 }], source: 'confirmed' });
assert.equal(strong.fit, 100);
assert.ok(guessed.fit < strong.fit, 'guessed skills count less than confirmed ones');
assert.deepEqual([half.matched, half.missing], [['React Native'], ['REST APIs']]);
assert.ok(half.fit > 30 && half.fit < 60);

// the team match
const brief: Brief = { ...cleanBrief(aiBrief, { clientPrice: 2_200_000 }, doc, T) };
const cand = (uid: string, title: string, skills: string[], over: Partial<Candidate> = {}): Candidate => ({
  uid, name: uid.toUpperCase(), title, department: 'Eng', skills: skills.map((name) => ({ name, level: 3 })), skillSource: 'confirmed', annualCtc: 1_300_000, leaveDays: 0, allocatedPct: 0, ...over,
});
const people: Candidate[] = [
  cand('priya', 'Mobile developer', ['React Native', 'REST APIs']),
  cand('rohan', 'Mobile developer', ['React Native', 'REST APIs'], { annualCtc: 1_040_000 }),
  cand('busy', 'Mobile developer', ['React Native', 'REST APIs'], { allocatedPct: 100 }),
  cand('leaver', 'Mobile developer', ['React Native', 'REST APIs'], { lastWorkingDay: '2027-01-15' }),
  cand('sneha', 'UI designer', ['Figma', 'UI design'], { leaveDays: 3 }),
  cand('sales', 'Sales lead', ['Sales']),
];
const team = matchTeam(brief, people);
assert.deepEqual(team.map((a) => a.uid).sort(), ['priya', 'rohan', 'sneha'], 'busy people and people leaving before the end are never picked');
assert.equal(team.find((a) => a.uid === 'sneha')!.allocation, 60);
assert.ok(team.find((a) => a.uid === 'sneha')!.notes.some((n) => /3 days of approved leave/.test(n)));
assert.ok(team.every((a) => !a.alternatives.some((x) => x.uid === 'busy')), 'a fully booked person is not even offered');
const noDesigner = matchTeam(brief, people.filter((p) => p.uid !== 'sneha'));
const gap = noDesigner.find((a) => a.role === 'Designer')!;
assert.equal(gap.uid, '', 'nobody suitable: a visible gap, not a bad pick');
assert.match(gap.notes[0], /Nobody free/);

// one person can not be booked past 100% across roles
const solo = matchTeam({ ...brief, roles: [{ title: 'Mobile developer', skills: ['React Native'], count: 1, allocation: 80 }, { title: 'Backend', skills: ['React Native'], count: 1, allocation: 80 }] }, [people[0]]);
assert.equal(solo[0].uid, 'priya');
assert.ok(solo[1].uid === '' || solo[0].allocation + solo[1].allocation <= 100);

// swapping
const swapped = swapAssignment(brief, team, team.find((a) => a.uid === 'rohan')!.key, people[5]);
assert.ok(Array.isArray(swapped) && swapped.some((a) => a.uid === 'sales'));
assert.match(String(swapAssignment(brief, team, team[0].key, people[3])), /leaves on 2027-01-15/);
assert.match(String(swapAssignment(brief, team, team[0].key, people[2])), /no free time/);
assert.match(String(swapAssignment(brief, team, 'nope', people[0])), /not in this plan/);

// the AI's plan is checked, clamped and given real dates and owners
const W = weeksOf(brief.startDate, brief.endDate);
const plan = checkPlan({
  summary: 'A 12 week build. The budget of ₹18 lakh is enough. Testing starts in week 9.',
  phases: [{ name: 'Design', startWeek: 1, weeks: 3 }, { name: 'Build', startWeek: 3, weeks: 99 }, { name: 'Design', startWeek: 5, weeks: 1 }, { name: '', startWeek: 1, weeks: 1 }],
  milestones: [{ week: 40, label: 'Launch' }, { week: 3, label: 'Designs approved' }],
  tasks: [
    { title: 'Wireframes', phase: 'Design', role: 'Designer', days: 6 },
    { title: 'Catalogue', phase: 'Build', role: 'Mobile developer', days: 9 },
    { title: 'Checkout', phase: 'Build', role: 'mobile developer', days: 90 },
    { title: 'Mystery', phase: 'Nope', role: 'Astronaut', days: 2 },
    { title: 'x', phase: 'Build', role: 'Designer', days: 1 },
  ],
  risks: [{ level: 'HIGH', title: 'Payments', body: 'New to the team. It costs Rs 60000 to hire help.', fix: 'Start early.' }, { level: 'weird', title: 'Store review', body: 'Slow', fix: '' }],
}, brief, team);
assert.equal(plan.summary, 'A 12 week build. Testing starts in week 9.', 'sentences about money are removed from AI text');
assert.deepEqual(plan.phases.map((p) => [p.name, p.startWeek, p.weeks]), [['Design', 1, 3], ['Build', 3, W - 2]], 'duplicates and blanks dropped, overruns clamped');
assert.equal(plan.phases[0].startDate, '2026-12-01');
assert.ok(plan.phases[1].endDate <= brief.endDate);
assert.equal(plan.tasks.length, 4, 'a title under 3 letters is dropped');
assert.equal(plan.tasks[2].days, 40, 'effort is capped');
assert.equal(plan.tasks[3].phase, 'Design', 'an unknown phase falls back to the first');
const devs = plan.tasks.filter((t) => t.role === 'Mobile developer').map((t) => t.ownerUid);
assert.equal(new Set(devs).size, 2, 'work for a role with two people is shared between them');
assert.equal(plan.tasks[0].ownerUid, 'sneha');
assert.deepEqual(plan.milestones.map((m) => m.week), [3, W], 'milestones sorted and clamped');
assert.equal(plan.risks[0].level, 'High');
assert.equal(plan.risks[0].body, 'New to the team.', 'money removed from risks too');
assert.equal(plan.risks[1].level, 'Medium');

// money
const ctc = new Map<string, number | null>([['priya', 1_300_000], ['rohan', 1_040_000], ['sneha', null]]);
const costs = costPlan(brief, team, plan, ctc);
const wd = workingDays(brief.startDate, brief.endDate);
assert.equal(costs.workdays, wd);
const priya = costs.people.find((p) => p.uid === 'priya')!;
assert.equal(priya.dailyCost, 5000);
assert.equal(priya.cost, 5000 * wd, 'daily cost x working days x 100%');
assert.equal(costs.people.find((p) => p.uid === 'sneha')!.cost, null, 'no salary: not guessed');
assert.equal(costs.missingSalary, 1);
assert.equal(costs.peopleTotal, 5000 * wd + 4000 * wd);
assert.equal(costs.otherTotal, 40_000);
assert.equal(costs.total, costs.peopleTotal + 40_000);
assert.equal(costs.headroom, 1_800_000 - costs.total);
assert.equal(costs.profit, 2_200_000 - costs.total);
assert.equal(costs.margin, Math.round(((2_200_000 - costs.total) / 2_200_000) * 10000) / 100);
assert.equal(costs.byPhase.reduce((n, p) => n + p.amount, 0), costs.total, 'phase split adds up to the total exactly');
const hidden = hidePersonalCost(costs);
assert.ok(hidden.people.every((p) => p.cost === null && p.dailyCost === null) && hidden.byRole.length === 0 && hidden.total === costs.total, 'totals only');
const health = healthChecks(brief, team, plan, costs);
assert.ok(health.some((h) => h.title === 'Costs are incomplete'));
assert.ok(health.some((h) => h.title === 'Deadline is tight' && /40/.test(h.body)) || health.some((h) => h.title === 'Work fits the time'));
assert.ok(health.some((h) => h.title === 'Leave during the project' && /SNEHA/.test(h.body)));
const over = healthChecks({ ...brief, budget: 100 }, team, plan, costPlan({ ...brief, budget: 100 }, team, plan, ctc));
assert.ok(over.some((h) => h.title === 'Over budget' && h.tone === 'bad'));

// ------------------------------------------------------------------ end to end through /api/hrbp (the model is scripted)

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tok('u_hr', ['hrbp.manage']); // can plan, cannot see pay, cannot make company tasks
const HR_PAY = tok('u_hr', ['hrbp.manage', 'payroll.view']);
const ADMIN = tok('u_adm', [], true);
const EMP = tok('u_priya');
const MGR = tok('u_mgr');
const OTHER = tok('u_x', ['hrbp.manage'], false, 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHrbp({ method, action, headers: h, body, query });

fdb.seed('companies', CID, { name: 'Acme Ltd', status: 'ACTIVE' });
const emp = (uid: string, name: string, title: string, active = true) => fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Eng', title });
emp('u_hr', 'Hema HR', 'HR manager'); emp('u_adm', 'Ada Admin', 'Director'); emp('u_mgr', 'Mira Manager', 'Engineering manager');
emp('u_priya', 'Priya Nair', 'Mobile developer'); emp('u_rohan', 'Rohan Desai', 'Mobile developer'); emp('u_sneha', 'Sneha Kulkarni', 'UI designer');
emp('u_imran', 'Imran Shaikh', 'Backend developer'); emp('u_leaver', 'Lata Leaver', 'Mobile developer'); emp('u_old', 'Old Timer', 'Mobile developer', false);
fdb.seed('employees', 'u_x', { companyId: 'c2', authUid: 'u_x', name: 'Xavier', email: 'x@o.com', active: true, title: 'Mobile developer' });
for (const uid of ['u_priya', 'u_rohan', 'u_sneha', 'u_imran', 'u_leaver']) fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: 'u_mgr' });
const SALARY: Record<string, number> = { u_priya: 1_300_000, u_rohan: 1_040_000, u_sneha: 910_000, u_imran: 1_170_000, u_leaver: 1_000_000 };
for (const [uid, ctcv] of Object.entries(SALARY)) fdb.seed('payrollStructures', `${CID}__${uid}`, { companyId: CID, uid, annualCtc: ctcv, amounts: {} });
fdb.seed('lifecycleExits', `${CID}__u_leaver`, { companyId: CID, uid: 'u_leaver', status: 'APPROVED', lastWorkingDay: '2027-01-10' });
fdb.seed('leaveRequests', 'lr1', { companyId: CID, uid: 'u_sneha', status: 'APPROVED', detail: [{ date: '2026-12-08', value: 1 }, { date: '2026-12-09', value: 1 }] });

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.OPENAI_PLANNER_MODEL;
delete process.env.OPENAI_PLANNER_READ_MODEL;
const realFetch = globalThis.fetch;
const sent: any[] = [];
let replies: any[] = [];
globalThis.fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init.body);
  sent.push(body);
  const content = replies.shift();
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as any;
const READ = {
  name: 'ShopKart app', summary: 'A shopping app for Android and iOS.', goals: ['Launch before March'], deliverables: ['Android app', 'iOS app', 'Admin panel'],
  startDate: '2026-12-01', endDate: '2027-02-23', budget: 1_800_000, clientPrice: 5_000_000, otherCosts: [{ label: 'Cloud hosting', amount: 40_000 }],
  roles: [{ title: 'Mobile developer', skills: ['React Native', 'REST APIs'], count: 2, allocation: 100 }, { title: 'UI designer', skills: ['Figma', 'UI design'], count: 1, allocation: 60 }, { title: 'Payments engineer', skills: ['Razorpay', 'PCI compliance'], count: 1, allocation: 50 }],
  constraints: ['Must ship before March'],
};
const PLAN = {
  summary: 'Design first, then two developers build in parallel, then testing.',
  phases: [{ name: 'Design', startWeek: 1, weeks: 3 }, { name: 'Build', startWeek: 3, weeks: 7 }, { name: 'Testing', startWeek: 10, weeks: 3 }],
  milestones: [{ week: 3, label: 'Designs approved' }, { week: 12, label: 'Store release' }],
  tasks: [
    { title: 'Wireframes and flows', description: 'Main flows.', phase: 'Design', role: 'UI designer', days: 6 },
    { title: 'Visual design', description: 'Screens.', phase: 'Design', role: 'UI designer', days: 8 },
    { title: 'App shell and login', description: 'Base app.', phase: 'Build', role: 'Mobile developer', days: 5 },
    { title: 'Catalogue and search', description: 'Browse.', phase: 'Build', role: 'Mobile developer', days: 9 },
    { title: 'Cart and checkout', description: 'Pay.', phase: 'Build', role: 'Mobile developer', days: 8 },
    { title: 'Payment gateway', description: 'Razorpay.', phase: 'Build', role: 'Payments engineer', days: 6 },
    { title: 'Regression testing', description: 'Test.', phase: 'Testing', role: 'Mobile developer', days: 5 },
  ],
  risks: [{ level: 'High', title: 'Payments', body: 'Nobody has done Razorpay.', fix: 'Hire a contractor.' }],
};
const b64 = (s: string) => `data:text/plain;base64,${Buffer.from(s).toString('base64')}`;
const DOC = 'ShopKart mobile app brief.\nWe need Android and iOS apps with a catalogue, cart and Razorpay checkout, plus an admin panel.\nBudget: 18 lakh. Hosting: 40,000. Start 1 December 2026, launch by 23 February 2027.';

async function main() {
  // access
  assert.equal((await call(EMP, 'GET', 'plan-list')).status, 403, 'employees cannot open the planner');
  assert.equal((await call(MGR, 'POST', 'plan-read', {})).status, 403);
  assert.equal((await call(HR, 'POST', 'plan-list')).status, 405);
  assert.equal((await call(HR, 'GET', 'plan-list')).json.models.plan, 'gpt-4o');

  // skills: the employee fills, the manager confirms, others cannot
  let r = await call(EMP, 'GET', 'skill-my');
  assert.equal(r.json.suggested, true, 'before filling in, skills are guessed from the title');
  assert.ok(r.json.skills.some((s: any) => s.name === 'React Native'));
  assert.equal((await call(EMP, 'POST', 'skill-save', { skills: [] })).status, 400);
  r = await call(EMP, 'POST', 'skill-save', { skills: [{ name: 'React Native', level: 3 }, { name: 'REST APIs', level: 3 }, 'TypeScript'] });
  assert.match(r.json.message, /Mira Manager will confirm/);
  assert.equal((await call(EMP, 'GET', 'skill-my')).json.status, 'SUBMITTED');
  assert.equal((await call(tok('u_rohan'), 'POST', 'skill-confirm', { uid: 'u_priya' })).status, 403, 'a colleague cannot confirm');
  assert.equal((await call(EMP, 'POST', 'skill-confirm', { uid: 'u_priya' })).status, 403, 'nobody confirms their own');
  const team = await call(MGR, 'GET', 'skill-team');
  assert.equal(team.json.scope, 'team');
  assert.equal(team.json.waiting, 1);
  assert.equal(team.json.items[0].uid, 'u_priya', 'waiting people first');
  assert.ok(!team.json.items.some((x: any) => x.uid === 'u_hr'), 'a manager sees only their reports');
  assert.equal((await call(MGR, 'POST', 'skill-confirm', { uid: 'u_priya' })).status, 200);
  assert.equal((await call(EMP, 'GET', 'skill-my')).json.status, 'CONFIRMED');
  assert.equal((await call(HR, 'POST', 'skill-confirm', { uid: 'u_rohan', skills: ['React Native', 'REST APIs'] })).status, 200, 'HRBP managers confirm anyone');
  assert.equal((await call(HR, 'GET', 'skill-team')).json.scope, 'company');

  // reading a document: gpt-4o-mini, and invented money is dropped
  replies = [READ];
  assert.equal((await call(HR, 'POST', 'plan-read', { mode: 'file', fileName: 'brief.exe', data: b64(DOC) })).status, 400, 'only PDF, Word and text');
  assert.equal(sent.length, 0, 'a refused file costs no AI call');
  assert.equal((await call(HR, 'POST', 'plan-read', { mode: 'file', fileName: 'brief.txt', data: b64('too short') })).status, 400);
  assert.equal((await call(HR, 'POST', 'plan-read', { mode: 'file', fileName: 'big.txt', data: 'A'.repeat(4_300_000) })).status, 400, 'over 3 MB');
  r = await call(HR, 'POST', 'plan-read', { mode: 'file', fileName: 'brief.txt', data: b64(DOC) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(sent.at(-1).model, 'gpt-4o-mini', 'the document is read with gpt-4o-mini');
  assert.ok(String(sent.at(-1).messages[1].content).includes('Razorpay checkout'), 'the document text was sent');
  const brief = r.json.plan.brief;
  assert.equal(r.json.plan.status, 'BRIEF');
  assert.equal(brief.budget, 1_800_000, '18 lakh is in the document');
  assert.equal(brief.clientPrice, null, 'the 50 lakh price is not in the document, so it is not trusted');
  assert.ok(brief.warnings.some((w: string) => /client price/.test(w)));
  const id = r.json.plan.id;
  assert.equal((await call(OTHER, 'GET', 'plan-get', {}, { id })).status, 404, 'another company cannot see it');

  // the person checks the brief and adds the price; building needs dates and roles
  assert.equal((await call(HR, 'POST', 'plan-brief', { id, brief: { ...brief, roles: [] } })).status, 200);
  assert.match((await call(HR, 'POST', 'plan-build', { id })).json.error, /role/);
  r = await call(HR, 'POST', 'plan-brief', { id, brief: { ...brief, clientPrice: 2_200_000 } });
  assert.equal(r.json.plan.brief.clientPrice, 2_200_000);

  // build: the team is matched in code, the plan drafted by gpt-4o, and no salary goes to the AI
  replies = [PLAN];
  const before = sent.length;
  r = await call(HR, 'POST', 'plan-build', { id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(sent.length, before + 1, 'one AI call for the plan');
  const planCall = JSON.stringify(sent.at(-1).messages);
  assert.equal(sent.at(-1).model, 'gpt-4o', 'the plan is drafted with gpt-4o');
  for (const v of Object.values(SALARY)) {
    assert.ok(!planCall.includes(String(v)) && !planCall.includes(String(Math.round(v / 260))), `salary ${v} must never reach the AI`);
  }
  assert.ok(!planCall.includes('1800000') && !planCall.includes('2200000') && !planCall.includes('40000'), 'no budget, price or cost goes to the AI either');
  let p = r.json.plan;
  assert.equal(p.status, 'DRAFT');
  const seat = (role: string) => p.team.filter((a: any) => a.role === role);
  assert.deepEqual(seat('Mobile developer').map((a: any) => a.uid).sort(), ['u_priya', 'u_rohan'], 'confirmed mobile developers; the leaver and the inactive person are skipped');
  assert.equal(seat('UI designer')[0].uid, 'u_sneha');
  assert.ok(seat('UI designer')[0].notes.some((n: string) => /2 days of approved leave/.test(n)));
  assert.equal(seat('Payments engineer')[0].uid === '' || seat('Payments engineer')[0].fit < 50, true, 'nobody has payments skills: shown as a gap');
  assert.ok(p.health.some((h: any) => /skill gap/.test(h.title)));
  // costs, for someone without payroll access: totals only
  assert.ok(p.costs.total > 0);
  assert.equal(p.canSeePay, false);
  assert.ok(p.costs.people.every((x: any) => x.cost === null), 'HR without payroll access does not see personal cost');
  assert.equal(p.costs.byRole.length, 0);
  // the same plan with payroll access shows the figures, worked out from CTC
  const withPay = (await call(HR_PAY, 'GET', 'plan-get', {}, { id })).json.plan;
  const priyaCost = withPay.costs.people.find((x: any) => x.uid === 'u_priya');
  assert.equal(priyaCost.dailyCost, 5000);
  assert.equal(priyaCost.cost, 5000 * withPay.costs.workdays);
  assert.equal(withPay.costs.profit, 2_200_000 - withPay.costs.total);
  assert.equal(withPay.costs.otherTotal, 40_000);
  assert.ok(p.headline.includes('profit'), 'the headline numbers come from code');
  assert.equal(p.plan.tasks.length, 7);
  assert.ok(p.plan.tasks.filter((t: any) => t.role === 'Mobile developer').every((t: any) => ['u_priya', 'u_rohan'].includes(t.ownerUid)));

  // swap the designer: costs and task owners follow
  const designerKey = seat('UI designer')[0].key;
  const pick = await call(HR, 'GET', 'plan-people', {}, { id, key: designerKey });
  assert.ok(pick.json.items.every((x: any) => x.uid !== 'u_leaver' && x.uid !== 'u_old'), 'leavers and inactive people are not offered');
  assert.ok(pick.json.items.every((x: any) => x.annualCtc === undefined), 'no salary in the picker');
  const leaverSwap = await call(HR, 'POST', 'plan-swap', { id, key: designerKey, uid: 'u_leaver' });
  assert.equal(leaverSwap.status, 400);
  assert.match(leaverSwap.json.error, /leaves on 2027-01-10/, 'someone leaving before the end is refused with the reason');
  r = await call(HR, 'POST', 'plan-swap', { id, key: designerKey, uid: 'u_imran' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  p = r.json.plan;
  assert.ok(p.plan.tasks.filter((t: any) => t.assignmentKey === designerKey).every((t: any) => t.ownerUid === 'u_imran'));
  r = await call(HR, 'POST', 'plan-swap', { id, key: designerKey, uid: 'u_sneha' });
  p = r.json.plan;

  // approve: needs Tasks permission; creates the board and tasks once; books time
  assert.equal((await call(HR, 'POST', 'plan-approve', { id })).status, 403, 'hrbp.manage alone cannot assign company tasks');
  assert.equal((await call(ADMIN, 'POST', 'plan-approve', { id })).status, 200);
  const again = await call(ADMIN, 'POST', 'plan-approve', { id });
  assert.equal(again.json.message, 'Already approved.');
  const board = (await routeTasks({ method: 'GET', action: 'projects', headers: ADMIN, body: {}, query: {} })).json.items.find((x: any) => x.name === 'ShopKart app');
  assert.ok(board, 'a Tasks board was made');
  const all = (await routeTasks({ method: 'GET', action: 'list', headers: ADMIN, body: {}, query: { scope: 'project', projectId: board.id } })).json.items;
  const owned = p.plan.tasks.filter((t: any) => t.ownerUid).length;
  assert.equal(all.length, owned, 'every task with an owner was created exactly once');
  assert.ok(all.some((t: any) => t.title === 'Catalogue and search' && ['u_priya', 'u_rohan'].includes(t.assigneeUid)));
  const allocations = (await fdb.collection('hrbpItems').get()).docs.map((d: any) => d.data()).filter((x: any) => x.kind === 'allocation');
  assert.equal(allocations.length, p.team.filter((a: any) => a.uid).length);
  assert.equal((await call(ADMIN, 'POST', 'plan-swap', { id, key: designerKey, uid: 'u_imran' })).status, 409, 'an approved plan is locked');
  assert.equal((await call(ADMIN, 'POST', 'plan-brief', { id, brief })).status, 409);

  // the next plan sees those people as busy
  replies = [{ ...READ, name: 'Second app', clientPrice: null }];
  const id2 = (await call(HR, 'POST', 'plan-read', { mode: 'text', name: 'Second app', summary: 'Another mobile app with React Native for the same dates, two developers.', startDate: '2026-12-01', endDate: '2027-02-23', budget: 900_000 })).json.plan.id;
  replies = [PLAN];
  const second = (await call(HR, 'POST', 'plan-build', { id: id2 })).json.plan;
  assert.ok(!second.team.some((a: any) => a.uid === 'u_priya' || a.uid === 'u_rohan'), 'fully booked people are not matched again');
  assert.equal(second.costs.profit, null, 'no price: headroom instead of profit');
  assert.equal(second.costs.headroom, 900_000 - second.costs.total);
  // archiving the approved plan frees them
  assert.equal((await call(ADMIN, 'POST', 'plan-archive', { id })).status, 200);
  replies = [PLAN];
  const third = (await call(HR, 'POST', 'plan-build', { id: id2 })).json.plan;
  assert.ok(third.team.some((a: any) => a.uid === 'u_priya'), 'free again after the first plan was archived');
  assert.ok(!(await call(HR, 'GET', 'plan-list')).json.items.some((x: any) => x.id === id), 'archived plans leave the list');

  // AI switched off: a clear message, no crash
  delete process.env.OPENAI_API_KEY;
  assert.equal((await call(HR, 'POST', 'plan-read', { mode: 'text', summary: 'x'.repeat(60) })).status, 503);
  globalThis.fetch = realFetch;
  console.log('project planner ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
