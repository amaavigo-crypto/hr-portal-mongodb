/**
 * Wellbeing agent: the tools, what the model is allowed to see, and the HR-only Monday nudge.
 * Run: npx tsx tests/wellbeingAgent.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeAssistant } from '../api/_lib/assistantApi.ts';
import { routeWellbeing } from '../api/_lib/wellbeingApi.ts';
import { buildDigests } from '../shared/agentWatcher.ts';
import { CONSENT_VERSION } from '../shared/wellbeingEngine.ts';
import {
  WELLBEING_AGENT_TOOLS, canViewWellbeing, explainWellbeing, isMonday, summarizeMe, summarizeOverview, wellbeingNudge, wellbeingToolsFor,
} from '../shared/wellbeingAgentTools.ts';

// ------------------------------------------------------------------ pure parts
const names = (w: any) => wellbeingToolsFor(w).map((t) => t.name);
assert.deepEqual(names({ perms: [] }), ['get_my_wellbeing', 'explain_wellbeing']);
assert.equal(names({ perms: ['wellbeing.view'] }).length, WELLBEING_AGENT_TOOLS.length);
assert.equal(names({ perms: [], isCompanyAdmin: true }).length, WELLBEING_AGENT_TOOLS.length);
assert.equal(canViewWellbeing({ perms: ['leave.manage'] }), false);
assert.ok(WELLBEING_AGENT_TOOLS.every((t) => t.kind === 'read'), 'read only');
assert.ok(WELLBEING_AGENT_TOOLS.every((t) => !JSON.stringify(t.parameters).match(/companyId|uid|person|employee/i)), 'no tool can ask about one person or another company');

const me = summarizeMe({ consent: { answered: true, optedIn: true }, games: [{ id: 'fruit-catch', name: 'Fruit Catch', minutes: 3, best: 900 }], today: { plays: 1, cap: 3, left: 2 }, streak: 4,
  recent: [{ game: 'fruit-catch', points: 800, at: '2026-11-20T10:00:00Z' }] } as any, { plays: 9, bestStreak: 6 });
assert.deepEqual([me.playsLeftToday, me.streakDays, me.bestStreakDays, me.totalPlays], [2, 4, 6, 9]);
assert.ok(!/skill|reaction|impulse/i.test(JSON.stringify(me)), 'a player summary has no skill numbers');
assert.match(summarizeMe({ consent: { answered: true, optedIn: false }, today: { plays: 0, cap: 3, left: 3 } } as any, null).note!, /not opted in/);

assert.ok(!explainWellbeing(false).skills && explainWellbeing(true).skills, 'skill meanings only for people who see group results');
assert.match(JSON.stringify(explainWellbeing(false)), /not a medical/);

const ov = summarizeOverview({ participation: { optedIn: 12, people: 30, percent: 40 }, players: 10, playsPerWeek: 2, hiddenGroups: 1, minGroup: 5,
  groups: [{ name: 'Finance', players: 6, skills: { reaction: { level: 71, members: 6, trend: 3 }, memory: null } }] } as any);
assert.equal(ov.departments[0].skills.length, 1);
assert.equal(ov.departments[0].skillsHiddenForPrivacy, 1);
assert.equal(ov.departmentsHiddenForPrivacy, 1);

// the nudge: Mondays only, big enough company, never about a person
assert.equal(isMonday('2026-11-23'), true);
assert.equal(isMonday('2026-11-24'), false);
assert.equal(wellbeingNudge({ people: 40, optedIn: 3, playsLastDays: 5 }, '2026-11-24'), null, 'not a Monday');
assert.equal(wellbeingNudge({ people: 5, optedIn: 0, playsLastDays: 0 }, '2026-11-23'), null, 'too small to matter');
assert.match(wellbeingNudge({ people: 40, optedIn: 3, playsLastDays: 5 }, '2026-11-23')!, /3 of 40/);
assert.match(wellbeingNudge({ people: 40, optedIn: 20, playsLastDays: 0 }, '2026-11-23')!, /Nobody has played/);
assert.equal(wellbeingNudge({ people: 40, optedIn: 20, playsLastDays: 50 }, '2026-11-23'), null, 'healthy programme: silence');
assert.equal(wellbeingNudge(undefined, '2026-11-23'), null);

const base = { people: [{ uid: 'hr', name: 'Hema', email: 'h@x' }, { uid: 'e', name: 'Esha', email: 'e@x' }], hrUids: ['hr'], leaves: [], exceptions: [], exits: [], tasks: [], records: [] };
const mon = buildDigests({ ...base, today: '2026-11-23', wellbeing: { people: 40, optedIn: 3, playsLastDays: 5, viewerUids: ['hr'] } });
assert.ok(mon.find((d) => d.uid === 'hr')!.sections.some((s) => /Wellbeing games \(1\)/.test(s.heading)));
assert.ok(!mon.some((d) => d.uid === 'e'), 'players are never nudged');
assert.ok(!buildDigests({ ...base, today: '2026-11-24', wellbeing: { people: 40, optedIn: 3, playsLastDays: 5, viewerUids: ['hr'] } }).some((d) => d.uid === 'hr'));

// ------------------------------------------------------------------ end to end through Ask HR (the model is scripted)
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tokenFor('u_hr', ['wellbeing.view']);
const EMP = tokenFor('u_emp');
fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_emp', 'Esha Employee']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Finance', empId: uid, title: 'Staff' });
}
fdb.seed('wbConsent', `${CID}__u_emp`, { companyId: CID, uid: 'u_emp', optedIn: true, version: CONSENT_VERSION, at: new Date().toISOString() });

process.env.OPENAI_API_KEY = 'test-key';
let seenTools: string[] = []; let toolReplies: any[] = [];
const script = (calls: { name: string }[]) => {
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    seenTools = (body.tools || []).map((t: any) => t.function.name);
    toolReplies = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const last = body.messages[body.messages.length - 1];
    const message = last.role !== 'tool'
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `t${i}`, type: 'function', function: { name: c.name, arguments: '{}' } })) }
      : { role: 'assistant', content: 'Done.' };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
};
const run = async (h: any, calls: { name: string }[]) => { script(calls); return routeAssistant({ method: 'POST', action: 'ask', headers: h, query: {}, body: { question: 'wellbeing?' } }); };

await run(EMP, [{ name: 'get_my_wellbeing' }, { name: 'get_wellbeing_overview' }, { name: 'explain_wellbeing' }]);
assert.ok(seenTools.includes('get_my_wellbeing') && !seenTools.includes('get_wellbeing_overview'), `EMP was shown: ${seenTools}`);
assert.equal(toolReplies[0].optedIn, true);
assert.ok(toolReplies[0].playsLeftToday > 0);
assert.ok(!/skill|reaction|impulse/i.test(JSON.stringify(toolReplies[0])), 'no skill numbers for a player');
assert.match(toolReplies[1].error, /Not available/);
assert.ok(toolReplies[2].whoSeesWhat.length >= 3);

await run(HR, [{ name: 'get_wellbeing_overview' }, { name: 'explain_wellbeing' }]);
assert.ok(seenTools.includes('get_wellbeing_overview'));
assert.equal(toolReplies[0].optedIn, 1);
assert.deepEqual(toolReplies[0].departments, [], 'one player is far below the group minimum, so no department is shown');
assert.ok(toolReplies[1].skills, 'group viewers get the skill meanings');
assert.ok(!seenTools.some((n) => /person|individual|forget|consent/.test(n)), 'no per-person, consent or delete tool exists');

const noView = await routeWellbeing({ method: 'GET', action: 'overview', headers: EMP, body: {}, query: {} });
assert.equal(noView.status, 403, 'the route still refuses a player, whatever the agent does');

console.log('wellbeing agent tests passed');
