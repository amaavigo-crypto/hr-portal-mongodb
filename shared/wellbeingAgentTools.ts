/**
 * Wellbeing agent: tool registry and the wording that must NOT be left to the model.
 * Pure code (no database, no network), tested in tests/wellbeingAgent.test.ts.
 *
 * Read only, on purpose. The Wellbeing games are built on privacy rules, and this agent keeps every one of them:
 *   - a player is told only fun scores (points, streak, personal bests), never a skill number
 *   - HR sees groups of MIN_GROUP or more people, never one person (there is no per-person tool here at all)
 *   - nobody is ranked, and the agent does not diagnose, label personalities or advise on hiring, firing or promotion
 * The thresholds are applied by the Wellbeing route; the agent only passes along what that route returns.
 *
 * `access`:  all   every signed-in person (the route only returns their own fun stats)
 *            view  needs a Wellbeing view permission (or company admin)
 * This decides which tools the model is told about. It is not the security boundary: each tool calls the same Wellbeing
 * route the screens use, with the person's own login, and that route checks company and permission again.
 */
import { hasAnyPerm } from './permissions.js';
import { cleanText } from './leaveAgentTools.js';
import { GAMES, MIN_GROUP, MIN_PLAYS, SKILLS, type SkillId } from './wellbeingEngine.js';

export type WellbeingToolAccess = 'all' | 'view';
export interface WellbeingAgentTool { name: string; kind: 'read'; access: WellbeingToolAccess; description: string; parameters: Record<string, any> }

const none = { type: 'object', properties: {}, additionalProperties: false };

export const WELLBEING_AGENT_TOOLS: WellbeingAgentTool[] = [
  {
    name: 'get_my_wellbeing', kind: 'read', access: 'all',
    description: 'The signed-in person\'s OWN game stats: whether they opted in to recorded games, the games available (name, minutes, their best score), plays left today, current and best streak, total plays and recent sessions. Fun scores only: it never has a skill number. Use it for "what is my streak", "how many plays do I have left" and for suggesting a game that fits the minutes they have.',
    parameters: none,
  },
  {
    name: 'explain_wellbeing', kind: 'read', access: 'all',
    description: 'The fixed explanation of how Wellbeing works: what the games are, what is recorded, who can see what, and what it is not for. Use it for any privacy or "how does this work" question, and quote its facts instead of improvising.',
    parameters: none,
  },
  {
    name: 'get_wellbeing_overview', kind: 'read', access: 'view',
    description: 'HR view of Wellbeing across the company: how many people opted in, how many play and how often, and skill levels per department for departments with enough players. Departments with too few players are hidden by the system and only counted. There is no per-person view here.',
    parameters: none,
  },
];

export interface WellbeingWho { perms?: string[] | null; isCompanyAdmin?: boolean }
export const canViewWellbeing = (w: WellbeingWho) => !!w.isCompanyAdmin || hasAnyPerm(w.perms, ['wellbeing.view', 'wellbeing.view_individual', 'wellbeing.manage']);
export const mayUseWellbeingTool = (w: WellbeingWho, t: Pick<WellbeingAgentTool, 'access'>) => t.access === 'all' || canViewWellbeing(w);
export const wellbeingToolsFor = (w: WellbeingWho): WellbeingAgentTool[] => WELLBEING_AGENT_TOOLS.filter((t) => mayUseWellbeingTool(w, t));

export function wellbeingRoleLine(w: WellbeingWho): string {
  return canViewWellbeing(w)
    ? 'For Wellbeing this person can see group results (departments of 5 or more players) and their own game stats. They cannot open one person\'s results through you.'
    : 'For Wellbeing this person can see only their own game stats (fun scores, streak, personal bests), never a skill number.';
}

/** Rules the model must follow whenever it talks about Wellbeing. Added to the system prompt. */
export const WELLBEING_RULES = [
  '- Wellbeing: you only talk about the games and group-level results the tools return. Never give anyone a skill score, and never rank, compare or single out people. Do not diagnose, give medical or mental-health conclusions, label a personality, or advise on hiring, firing, promotion or pay from game results; if asked, say the games are not designed for that. Opting in or out and deleting recorded data are done on the Wellbeing screen (Forget me), not through you. Do not push anyone to play; playing is voluntary.',
].join('\n');

// ------------------------------------------------------------------ what the route returns, shaped for the model

export interface MeLike {
  consent?: { answered?: boolean; optedIn?: boolean };
  games?: { id: string; name: string; tagline?: string; minutes: number; best: number }[];
  today?: { plays: number; cap: number; left: number };
  streak?: number;
  recent?: { game: string; points: number; at?: string }[];
}
export interface ProgressLike { plays?: number; bestStreak?: number; bests?: Record<string, number> }

export function summarizeMe(me: MeLike, progress: ProgressLike | null) {
  const c = me.consent || {};
  const left = me.today?.left ?? 0;
  const games = (me.games || []).map((g) => ({ game: cleanText(g.name, 40), gameId: g.id, tagline: cleanText(g.tagline, 80), minutes: g.minutes, yourBest: g.best || 0 }));
  return {
    optedIn: !!c.optedIn,
    answeredConsent: !!c.answered,
    playsToday: me.today?.plays ?? 0, dailyLimit: me.today?.cap ?? 0, playsLeftToday: left,
    streakDays: me.streak ?? 0, bestStreakDays: progress?.bestStreak ?? null, totalPlays: progress?.plays ?? null,
    games,
    recent: (me.recent || []).slice(0, 5).map((s) => ({ game: GAMES[s.game as keyof typeof GAMES]?.name || cleanText(s.game, 40), points: s.points, at: String(s.at || '').slice(0, 10) })),
    note: !c.optedIn
      ? 'This person has not opted in to recorded games: they can still play for fun, but nothing is recorded or counted.'
      : left === 0 ? 'The daily limit is reached; more plays open tomorrow.' : undefined,
  };
}

export function explainWellbeing(canSeeGroups: boolean) {
  return {
    what: 'Short games of a few minutes that are fun to play. Each game also measures a few work-related skills from the raw answers, not from the points.',
    games: Object.values(GAMES).map((g) => ({ name: g.name, minutes: g.minutes, tagline: g.tagline })),
    whatIsRecorded: 'Only if the person opts in: the answers and timings of each session. Without opting in, a game can be played but nothing is saved or counted.',
    whoSeesWhat: [
      'The player sees fun scores: points, streak, personal bests. Never a skill number.',
      `HR with the right permission sees results for groups of ${MIN_GROUP} or more people. Smaller groups are hidden.`,
      'One person\'s skill picture needs a separate permission, only appears after enough plays, and every open is written to an audit log.',
    ],
    howNumbersWork: `Skills are scored 0 to 100 and compare a person with their own history, never with colleagues. A skill is shown only after ${MIN_PLAYS} sessions.`,
    yourControls: 'You can opt in or out, and delete everything recorded about you with Forget me, on the Wellbeing screen.',
    notFor: 'These games are not a medical or mental-health test and are not designed to decide hiring, firing, promotion or pay.',
    ...(canSeeGroups ? { skills: (Object.keys(SKILLS) as SkillId[]).map((id) => ({ skill: SKILLS[id].label, meaning: SKILLS[id].blurb })) } : {}),
  };
}

export interface OverviewLike {
  participation?: { optedIn: number; people: number; percent: number };
  players?: number; playsPerWeek?: number; hiddenGroups?: number; minGroup?: number; minPlays?: number;
  groups?: { name: string; players: number; relevant?: string[]; skills: Record<string, { level: number; members: number; trend: number | null } | null> }[];
}

export function summarizeOverview(o: OverviewLike, cap = 10) {
  return {
    peopleInCompany: o.participation?.people ?? 0, optedIn: o.participation?.optedIn ?? 0, optedInPercent: o.participation?.percent ?? 0,
    playersWithSessions: o.players ?? 0, playsPerWeekPerPlayer: o.playsPerWeek ?? 0,
    departmentsShown: Math.min((o.groups || []).length, cap), departmentsHiddenForPrivacy: o.hiddenGroups ?? 0, minimumGroupSize: o.minGroup ?? MIN_GROUP,
    departments: (o.groups || []).slice(0, cap).map((g) => ({
      department: cleanText(g.name, 60), players: g.players,
      skills: Object.entries(g.skills || {}).filter(([, v]) => !!v).map(([id, v]) => ({
        skill: SKILLS[id as SkillId]?.label || id, averageLevel: v!.level, playersCounted: v!.members, trendPoints: v!.trend,
      })),
      skillsHiddenForPrivacy: Object.values(g.skills || {}).filter((v) => !v).length,
    })),
    reminder: 'These are department averages. Do not name, rank or compare individuals, and do not use them for hiring, firing or promotion decisions.',
  };
}

// ------------------------------------------------------------------ the daily watcher: HR only, weekly, never the players

export const WATCH_WELLBEING_MIN_PEOPLE = 10;
export const WATCH_WELLBEING_LOW_PERCENT = 25;
export const WATCH_WELLBEING_QUIET_DAYS = 14;

/** Mondays only, so a quiet programme is not a daily nag. `today` is YYYY-MM-DD. */
export const isMonday = (today: string) => new Date(`${today}T00:00:00Z`).getUTCDay() === 1;

export interface WellbeingWatch { people: number; optedIn: number; playsLastDays: number }

/** The one line HR gets, or null when there is nothing to say. Nothing here ever reaches an employee. */
export function wellbeingNudge(w: WellbeingWatch | undefined, today: string): string | null {
  if (!w || !isMonday(today) || w.people < WATCH_WELLBEING_MIN_PEOPLE) return null;
  const pct = Math.round((w.optedIn / w.people) * 100);
  if (w.optedIn > 0 && w.playsLastDays === 0) return `Nobody has played in the last ${WATCH_WELLBEING_QUIET_DAYS} days (${w.optedIn} opted in)`;
  if (pct < WATCH_WELLBEING_LOW_PERCENT) return `Only ${w.optedIn} of ${w.people} people (${pct}%) have opted in to Wellbeing games`;
  return null;
}
