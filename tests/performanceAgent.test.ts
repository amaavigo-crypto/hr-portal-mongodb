/**
 * Performance agent: tools, who sees what, and that ratings and scores never reach the model.
 * Run: npx tsx tests/performanceAgent.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import {
  PERFORMANCE_AGENT_TOOLS, attentionReason, explainPerformance, performanceToolsFor, summarizeAttention, summarizeTeam,
} from '../shared/performanceAgentTools.ts';
import { istToday } from '../shared/pmEngine.ts';

const TODAY = istToday();
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ pure parts
const names = (w: any) => performanceToolsFor(w).map((t) => t.name);
assert.equal(names({ perms: [] }).length, 4);
assert.ok(!names({ perms: ['pm.view'] }).includes('get_review_cycles'), 'pm.view is grouped figures only, not the review pipeline');
assert.equal(names({ perms: ['pm.manage'] }).length, PERFORMANCE_AGENT_TOOLS.length);
assert.equal(names({ perms: ['pm.approve'] }).length, PERFORMANCE_AGENT_TOOLS.length);
assert.equal(names({ perms: [], isCompanyAdmin: true }).length, PERFORMANCE_AGENT_TOOLS.length);
assert.ok(PERFORMANCE_AGENT_TOOLS.every((t) => t.kind === 'read'), 'read only');
assert.ok(PERFORMANCE_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|uid|employee|person/i)), 'no tool can ask about a chosen person');
assert.equal(attentionReason({ status: 'DISPUTED' }, TODAY), 'The employee disagrees with the review');
assert.match(attentionReason({ status: 'SELF', selfDue: ago(3) }, TODAY), /overdue by 3 days/);
assert.equal(attentionReason({ status: 'SELF', selfDue: ago(-3) }, TODAY), '', 'not yet due');
assert.equal(attentionReason({ status: 'PUBLISHED' }, TODAY), '');
const att = summarizeAttention({ items: [
  { name: 'Asha', cycleName: 'Q3', status: 'DISPUTED', score: { final: 4.2, criticalBreach: true }, flags: ['x'], manager: { rating: 5 } },
  { name: 'Ben', cycleName: 'Q3', status: 'ACKNOWLEDGED', score: { final: 3 } },
] }, TODAY);
assert.deepEqual([att.needAttention, att.outOfReviews, att.items[0].name], [1, 2, 'Asha']);
assert.ok(!/4\.2|criticalBreach|"rating"|"score"|"final"/.test(JSON.stringify(att)), 'no ratings or scores in the summary');
assert.ok(!/"final"|"score"|"rating"/.test(JSON.stringify(summarizeTeam({ people: [{ name: 'A', plan: { status: 'ACTIVE' }, review: { cycleName: 'Q3', status: 'MANAGER', score: { final: 4 } }, pending: 2 }] }))));
assert.ok(explainPerformance(false).ratingScale.length === 5 && !('forHr' in explainPerformance(false)) && 'forHr' in explainPerformance(true));

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tokenFor('u_hr', ['pm.manage']);
const MGR = tokenFor('u_mgr');
const EMP = tokenFor('u_emp');
const OTHER = tokenFor('u_other');
fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name, mgr] of [['u_hr', 'Hema HR', ''], ['u_mgr', 'Mira Manager', ''], ['u_emp', 'Esha Employee', 'u_mgr'], ['u_other', 'Omar Other', '']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid, title: 'Staff' });
  fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: mgr, joinDate: '2022-01-01' });
}
fdb.seed('pmSettings', CID, { id: CID, companyId: CID, setupDone: true, setupDoneAt: '2026-01-01T00:00:00Z' });
fdb.seed('pmPlans', 'p_emp', { id: 'p_emp', companyId: CID, uid: 'u_emp', name: 'Esha Employee', status: 'ACTIVE', designation: 'Analyst', department: 'Ops', managerUid: 'u_mgr', managerName: 'Mira Manager', effectiveFrom: '2026-01-01', ackAt: '',
  kpis: [{ id: 'k1', kra: 'Delivery', kpi: 'Reports on time', target: '95%', weight: 100 }], sops: [{ id: 's1' }] });
fdb.seed('pmReviews', 'r_emp', { id: 'r_emp', companyId: CID, uid: 'u_emp', name: 'Esha Employee', cycleKey: '2026-Q3', cycleName: 'Q3 2026', status: 'MANAGER', selfDue: ago(20), managerDue: ago(5), managerUid: 'u_mgr', managerName: 'Mira Manager',
  self: { note: 'MY PRIVATE SELF NOTE' }, manager: { rating: 5, note: 'SECRET MANAGER WORDING' }, score: { final: 4.4 }, flags: [] });
fdb.seed('pmReviews', 'r_oth', { id: 'r_oth', companyId: CID, uid: 'u_other', name: 'Omar Other', cycleKey: '2026-Q3', cycleName: 'Q3 2026', status: 'DISPUTED', managerUid: 'u_hr', score: { final: 2.1, criticalBreach: true }, flags: ['f'], manager: { note: 'OMAR MANAGER NOTE' } });
fdb.seed('pmCycles', `${CID}_2026-Q3`, { id: `${CID}_2026-Q3`, companyId: CID, key: '2026-Q3', name: 'Q3 2026', selfDue: ago(20), managerDue: ago(5), hrDue: ago(-3) });

process.env.OPENAI_API_KEY = 'test-key';
let seenTools: string[] = []; let toolReplies: any[] = [];
const script = (calls: { name: string; args?: any }[]) => {
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const last = body.messages[body.messages.length - 1];
    const message = last.role !== 'tool'
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) }
      : { role: 'assistant', content: 'Done.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const run = async (h: any, calls: { name: string; args?: any }[]) => { script(calls); return routeAssistant({ method: 'POST', action: 'ask', headers: h, query: {}, body: { question: 'performance?' } }); };

// an employee: own plan and review stage; HR tools neither offered nor usable; no ratings
await run(EMP, [{ name: 'get_my_performance_todo' }, { name: 'get_my_performance' }, { name: 'get_reviews_needing_attention' }, { name: 'get_my_team_performance' }]);
assert.ok(seenTools.includes('get_my_performance') && !seenTools.includes('get_reviews_needing_attention') && !seenTools.includes('get_review_cycles'), `EMP was shown: ${seenTools}`);
assert.ok(toolReplies[0].items.some((i: any) => /self-review|targets/i.test(i.text)), JSON.stringify(toolReplies[0]));
assert.equal(toolReplies[1].plan.kpis[0].target, '95%');
assert.equal(toolReplies[1].plan.targetsAcknowledged, false);
assert.equal(toolReplies[1].reviews[0].stage, 'Waiting for manager');
assert.match(toolReplies[2].error, /Not available/);
assert.equal(toolReplies[3].directReports, 0, 'an employee manages nobody');
assert.ok(!/SECRET MANAGER|4\.4|OMAR|MY PRIVATE|"rating"/.test(JSON.stringify(toolReplies)), 'no ratings, scores or others\' notes');

// a manager sees only their own report, with stages and no ratings
await run(MGR, [{ name: 'get_my_team_performance' }]);
assert.equal(toolReplies[0].directReports, 1);
assert.equal(toolReplies[0].people[0].name, 'Esha Employee');
assert.equal(toolReplies[0].people[0].latestReview, 'Q3 2026: Waiting for manager');
assert.ok(!/SECRET|4\.4|OMAR/.test(JSON.stringify(toolReplies)));

// HR: cycles and what needs attention, without any score
await run(HR, [{ name: 'get_review_cycles' }, { name: 'get_reviews_needing_attention' }]);
assert.ok(seenTools.includes('get_review_cycles'));
assert.equal(toolReplies[0].cycles[0].reviews, 2);
assert.equal(toolReplies[1].needAttention, 2);
const reasons = toolReplies[1].items.map((i: any) => `${i.name}: ${i.why}`).sort();
assert.match(reasons[0], /Esha Employee: Manager review overdue by 5 days/);
assert.match(reasons[1], /Omar Other: The employee disagrees/);
assert.ok(!/SECRET|OMAR MANAGER|4\.4|2\.1|criticalBreach|"rating"/.test(JSON.stringify(toolReplies)), 'no ratings, scores or manager wording reach the model');
assert.ok(!seenTools.some((n) => /approve|publish|submit|rate|draft|ranking/.test(n)), 'no write tool exists');

// someone with no Performance rights sees nobody else's data
await run(OTHER, [{ name: 'get_my_team_performance' }, { name: 'get_my_performance' }]);
assert.equal(toolReplies[0].directReports, 0);
assert.equal(toolReplies[1].plan, null);

console.log('performance agent tests passed');
