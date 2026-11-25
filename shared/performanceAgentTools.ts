/**
 * Performance agent: tool registry, the pure summarizers and the wording that must NOT be left to the model.
 * Pure code (no database, no network), tested in tests/performanceAgent.test.ts.
 *
 * Read only, and deliberately thin on numbers. Performance data is the most sensitive in the portal, so through the agent:
 *   - HR sees where each review is stuck (stage, overdue, disputed, on hold), never ratings or scores. Those stay on the review screen.
 *   - an employee's own review shows its stage only; the screen shows what was shared
 *   - nobody is ranked or compared, and the agent never recommends a rating, promotion, pay change or termination
 * The route (`/api/pm/*`) does every permission check; the agent only reshapes what the route returns for this person.
 *
 * `access`:  all  every signed-in person (the route limits managers to their own reports)
 *            hr   pm.manage / pm.approve (or company admin)
 */
import { hasAnyPerm } from './permissions.js';
import { cleanText, daysBetween } from './leaveAgentTools.js';
import { DEFAULT_WEIGHTS, RATING_WORDS, REVIEW_WORDS } from './pmEngine.js';

export type PerformanceToolAccess = 'all' | 'hr';
export interface PerformanceAgentTool { name: string; kind: 'read'; access: PerformanceToolAccess; description: string; parameters: Record<string, any> }

const none = { type: 'object', properties: {}, additionalProperties: false };

export const PERFORMANCE_AGENT_TOOLS: PerformanceAgentTool[] = [
  {
    name: 'get_my_performance_todo', kind: 'read', access: 'all',
    description: 'Everything waiting for the signed-in person in Performance: their own self-review, targets to acknowledge, check-ins, and, for managers, team items; for HR, approvals. Use it for "what is pending for me in performance".',
    parameters: none,
  },
  {
    name: 'get_my_performance', kind: 'read', access: 'all',
    description: 'The signed-in person\'s OWN Performance picture: their current plan and KPIs (targets, weights, verified work), recent monthly check-ins, the stage of each review cycle, and growth plans. Review stages only, no ratings.',
    parameters: none,
  },
  {
    name: 'explain_performance', kind: 'read', access: 'all',
    description: 'The fixed explanation of how Performance works: what is measured, the 1 to 5 rating scale, how "Not observed" is treated, the review stages and what the agent will not do. Use it for any "how does performance work" question and quote its facts.',
    parameters: none,
  },
  {
    name: 'get_my_team_performance', kind: 'read', access: 'all',
    description: 'For a manager: each direct report\'s plan status, review stage and pending work items, plus check-ins and growth plans waiting for the manager. Returns nobody for people who manage no one. Only the manager\'s own reports, never ratings.',
    parameters: none,
  },
  {
    name: 'get_review_cycles', kind: 'read', access: 'hr',
    description: 'HR view: each review cycle (quarter) with how many reviews are at each stage and how many are done.',
    parameters: none,
  },
  {
    name: 'get_reviews_needing_attention', kind: 'read', access: 'hr',
    description: 'HR view: reviews that need attention now: employee disagrees, on hold because setup is missing, waiting for HR approval, or overdue at the self-review or manager stage. Stage and reason only, never ratings or scores.',
    parameters: { type: 'object', properties: { cycle: { type: 'string', description: 'Optional cycle key such as 2026-Q3.' } }, additionalProperties: false },
  },
];

export interface PerformanceWho { perms?: string[] | null; isCompanyAdmin?: boolean }
export const canRunPerformance = (w: PerformanceWho) => !!w.isCompanyAdmin || hasAnyPerm(w.perms, ['pm.manage', 'pm.approve']);
export const mayUsePerformanceTool = (w: PerformanceWho, t: Pick<PerformanceAgentTool, 'access'>) => t.access === 'all' || canRunPerformance(w);
export const performanceToolsFor = (w: PerformanceWho): PerformanceAgentTool[] => PERFORMANCE_AGENT_TOOLS.filter((t) => mayUsePerformanceTool(w, t));

export function performanceRoleLine(w: PerformanceWho): string {
  return canRunPerformance(w)
    ? 'For Performance this person can see their own plan and reviews, their team\'s status if they manage people, and where each review cycle is stuck. Never ratings through you.'
    : 'For Performance this person can see their own plan, check-ins and review stages, and their team\'s status if they manage people.';
}

/** Rules the model must follow whenever it talks about Performance. Added to the system prompt. */
export const PERFORMANCE_RULES = [
  '- Performance: you only report what the tools return. Never rank or compare people, never say who is a good or bad performer, and never recommend a rating, promotion, pay change, warning or termination. Do not write or suggest a manager\'s review text or ratings; the review screen has its own draft helper. Ratings and scores are not available to you: point to the review screen. You cannot submit, approve, publish or change anything in Performance.',
].join('\n');

// ------------------------------------------------------------------ summarizers (what the route returns, shaped for the model)

const words = (s: unknown) => REVIEW_WORDS[String(s)] || cleanText(s, 60);
const PLAN_WORDS: Record<string, string> = { SET_TARGETS: 'Waiting for the manager to set targets', HR_CHECK: 'Targets with HR for approval', ACTIVE: 'Active', ON_HOLD: 'On hold: something is missing', CLOSED: 'Closed' };
const planWords = (s: unknown) => PLAN_WORDS[String(s)] || cleanText(s, 60);

export function summarizeTodo(j: any, cap = 20) {
  const todo: any[] = Array.isArray(j?.todo) ? j.todo : [];
  return {
    count: todo.length,
    items: todo.slice(0, cap).map((t) => ({ for: t.who === 'me' ? 'you' : t.who === 'team' ? 'your team' : 'HR', text: cleanText(t.text, 200) })),
    more: Math.max(0, todo.length - cap),
    setupDone: j?.setupDone ?? undefined,
  };
}

export function summarizeMine(j: any) {
  const p = j?.plan;
  const kpis: any[] = Array.isArray(p?.kpis) ? p.kpis : [];
  return {
    plan: p ? {
      status: planWords(p.status), designation: cleanText(p.designation, 80), department: cleanText(p.department, 80), manager: cleanText(p.managerName, 80),
      from: String(p.effectiveFrom || '').slice(0, 10), targetsAcknowledged: !!p.ackAt, sopsToAcknowledge: Number(p.sopsToAck ?? 0),
      waitingOn: Array.isArray(p.holds) && p.holds.length ? p.holds.slice(0, 5).map((h: any) => cleanText(typeof h === 'string' ? h : h?.text || h?.reason, 120)) : undefined,
      kpis: kpis.slice(0, 15).map((k) => ({ area: cleanText(k.kra, 80), kpi: cleanText(k.kpi, 120), target: cleanText(k.target, 120) || 'not set yet', weightPercent: k.weight ?? null, verifiedWork: Number(k.evidence ?? 0), workAwaitingVerification: Number(k.pending ?? 0) })),
    } : null,
    checkIns: (Array.isArray(j?.checkins) ? j.checkins : []).slice(0, 3).map((c: any) => ({ month: cleanText(c.month, 10), status: cleanText(c.status, 20), notesAdded: !!c.wentWell })),
    reviews: (Array.isArray(j?.reviews) ? j.reviews : []).slice(0, 4).map((r: any) => ({ cycle: cleanText(r.cycleName, 40), stage: words(r.status) })),
    growthPlans: (Array.isArray(j?.growth) ? j.growth : []).slice(0, 4).map((g: any) => ({ type: cleanText(g.type, 20).toLowerCase(), status: cleanText(g.status, 20).toLowerCase() })),
    note: 'Ratings and the written review are on the Performance screen. This summary shows stages only.',
  };
}

export function explainPerformance(canRun: boolean) {
  return {
    whatIsMeasured: 'Three things: Results (the KRAs and KPIs in your plan), Behaviour (competencies) and SOP compliance (following approved processes).',
    defaultWeights: `By default Results ${DEFAULT_WEIGHTS.results}%, Behaviour ${DEFAULT_WEIGHTS.behaviour}%, SOP compliance ${DEFAULT_WEIGHTS.sop}%. HR can change these for your company.`,
    ratingScale: Object.entries(RATING_WORDS).map(([n, w]) => `${n} = ${w}`),
    notObserved: '"Not observed" is left out of the score. It is never counted as 0 or 3.',
    reviewStages: ['Self-review by the employee', 'Manager review', 'HR approval', 'Shared with the employee, who can accept or disagree', 'If the employee disagrees, HR handles it'],
    whoSeesWhat: 'You see your own review only after it is shared with you. Managers see their own team. HR and approvers see the whole company\'s reviews on the screens.',
    notFor: 'The agent does not rank people, recommend ratings, promotions, pay or terminations, and cannot submit or change anything.',
    ...(canRun ? { forHr: 'You can ask where review cycles are stuck. Ratings and scores are only on the review screens.' } : {}),
  };
}

export function summarizeTeam(j: any, cap = 25) {
  const people: any[] = Array.isArray(j?.people) ? j.people : [];
  return {
    directReports: people.length,
    people: people.slice(0, cap).map((p) => ({
      name: cleanText(p.name, 80), designation: cleanText(p.designation, 60),
      plan: p.plan ? planWords(p.plan.status) : 'No plan yet', targetsAcknowledged: p.plan ? !!p.plan.ackAt : undefined,
      holds: p.plan?.holds?.length ? p.plan.holds.length : undefined, hrAskedForChange: p.plan?.hrNote ? true : undefined,
      latestReview: p.review ? `${cleanText(p.review.cycleName, 40)}: ${words(p.review.status)}` : 'No review yet', workItemsToVerify: Number(p.pending ?? 0),
    })),
    checkInsDue: (Array.isArray(j?.checkins) ? j.checkins : []).length,
    growthPlansWaiting: (Array.isArray(j?.growth) ? j.growth : []).length,
    note: people.length ? undefined : 'This person has no direct reports in the portal.',
  };
}

export function summarizeCycles(j: any) {
  return {
    cycles: (Array.isArray(j?.items) ? j.items : []).slice(0, 6).map((c: any) => ({
      cycle: cleanText(c.name || c.key, 40), key: cleanText(c.key, 10), reviews: Number(c.total ?? 0), done: Number(c.done ?? 0),
      byStage: Object.fromEntries(Object.entries(c.count || {}).map(([k, v]) => [words(k), v])),
      selfDue: String(c.selfDue || '').slice(0, 10) || undefined, managerDue: String(c.managerDue || '').slice(0, 10) || undefined, hrDue: String(c.hrDue || '').slice(0, 10) || undefined,
    })),
    cyclesHRCanOpen: (Array.isArray(j?.canOpen) ? j.canOpen : []).map((q: any) => cleanText(q.name || q.key, 40)),
  };
}

/** Why a review needs attention, or '' when it does not. Stage and dates only. */
export function attentionReason(r: any, today: string): string {
  const s = String(r?.status || '');
  if (s === 'DISPUTED') return 'The employee disagrees with the review';
  if (s === 'ON_HOLD') return 'On hold: setup is missing';
  if (s === 'HR') return 'Waiting for HR approval';
  if (s === 'SELF' && r.selfDue && today > r.selfDue) return `Self-review overdue by ${daysBetween(r.selfDue, today)} days`;
  if (s === 'MANAGER' && r.managerDue && today > r.managerDue) return `Manager review overdue by ${daysBetween(r.managerDue, today)} days`;
  return '';
}

export function summarizeAttention(j: any, today: string, cap = 25) {
  const items: any[] = Array.isArray(j?.items) ? j.items : [];
  const rows = items.map((r) => ({ r, why: attentionReason(r, today) })).filter((x) => x.why);
  return {
    needAttention: rows.length, outOfReviews: items.length,
    items: rows.slice(0, cap).map(({ r, why }) => ({
      name: cleanText(r.name, 80), cycle: cleanText(r.cycleName, 40), stage: words(r.status), why,
      manager: cleanText(r.managerName, 80) || undefined, flagged: (Array.isArray(r.flags) ? r.flags.length : 0) > 0 || undefined,
    })),
    more: Math.max(0, rows.length - cap),
    reminder: 'Stages only. Ratings and scores are on the review screen, and are not for ranking or for pay, promotion or termination decisions made through chat.',
  };
}
