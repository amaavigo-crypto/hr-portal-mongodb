/**
 * The manager's weekly summary: the "Team this week" screen and the Monday email.
 * The picture is counted in code (shared/teamWeek.ts). The email's opening paragraph is written by the AI when it is on.
 * The email goes once per manager per week (reminderLog), on Monday, or Tuesday if Monday's run was missed.
 */
import { companyRequests, db, effectiveProfile, findLocation, loadPeople, loadProfiles, loadSettings, notify, nowIso } from './leaveCore.js';
import { aiEnabled, aiText } from './ai/index.js';
import { loadFlagSettings } from './flagsApi.js';
import { dayKind, daysBetween } from '../../shared/leaveEngine.js';
import { unverifiedNumbers } from '../../shared/assistantEngine.js';
import { basicIntro, buildTeamWeek, quietWeek, weekFacts, weeklyEmail, type TeamWeek, type WaitingReq } from '../../shared/teamWeek.js';

interface Result { status: number; json: any }
const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });

/** The people who report to a manager, with what they have booked. Empty when the person manages nobody. */
export async function loadTeamWeek(cid: string, managerUid: string, today: string): Promise<{ week: TeamWeek | null; managerName: string }> {
  const [people, profiles, { settings }, requests, flags] = await Promise.all([loadPeople(cid), loadProfiles(cid), loadSettings(cid), companyRequests(cid), loadFlagSettings(cid)]);
  const manager = people.find((p) => p.uid === managerUid);
  const team = people.filter((p) => p.active && p.uid !== managerUid && !profiles.get(p.uid)?.hidden && profiles.get(p.uid)?.managerUid === managerUid);
  if (!team.length) return { week: null, managerName: manager?.name || '' };
  const members = team.map((p) => {
    const loc = findLocation(settings, effectiveProfile(settings, p, profiles.get(p.uid)).locationId);
    return { uid: p.uid, name: p.name, isOff: (d: string) => dayKind(d, loc) !== 'WORK', requests: requests.filter((r) => r.uid === p.uid).map((r) => ({ from: r.from, to: r.to, status: r.status })) };
  });
  const mine = new Set(team.map((p) => p.uid));
  const waiting: WaitingReq[] = requests
    .filter((r) => mine.has(r.uid) && r.status === 'PENDING' && r.steps?.[r.stepIndex]?.role === 'MANAGER')
    .map((r) => ({ id: r.id, name: r.name, typeName: r.typeName, from: r.from, to: r.to, days: r.days, waitingDays: Math.max(0, daysBetween(String(r.createdAt).slice(0, 10), today)) }));
  return { week: buildTeamWeek(today, members, waiting, flags.teamLimitPct), managerName: manager?.name || '' };
}

/** GET team-week: for a manager, their own team. Anyone else gets team:false. */
export async function teamWeekView(cid: string, uid: string, today: string): Promise<Result> {
  const { week } = await loadTeamWeek(cid, uid, today);
  if (!week) return ok({ team: false });
  return ok({ team: true, week, intro: basicIntro(week) });
}

const SYSTEM = [
  'You write the opening paragraph of a weekly email to a team manager about their team\'s leave.',
  'You are given the facts. Write 2 to 3 plain sentences that say what matters most this week. No greeting, no list.',
  'Use only names, numbers and dates that appear in the facts. Do not calculate or guess. Do not comment on why anyone is away.',
].join('\n');

async function introFor(cid: string, uid: string, week: TeamWeek): Promise<string> {
  const facts = weekFacts(week);
  if (!aiEnabled()) return basicIntro(week);
  const res = await aiText({ cid, uid, feature: 'leave.summary', system: SYSTEM, user: facts, maxTokens: 200, temperature: 0.2, timeoutMs: 25_000, budgetMs: 30_000 });
  const text = String(res.text || '').trim();
  return res.error || !text || unverifiedNumbers(text, [facts]).length ? basicIntro(week) : text;
}

/** One email per manager for the week. Safe to run twice. */
export async function sendTeamWeeklySummaries(cid: string, today: string): Promise<{ managers: number; emails: number }> {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (wd !== 1 && wd !== 2) return { managers: 0, emails: 0 };
  const [people, profiles] = await Promise.all([loadPeople(cid), loadProfiles(cid)]);
  const bosses = new Set<string>();
  for (const p of people) if (p.active) { const m = profiles.get(p.uid)?.managerUid; if (m && m !== p.uid) bosses.add(m); }
  let emails = 0;
  for (const uid of bosses) {
    const boss = people.find((p) => p.uid === uid && p.active && p.email);
    if (!boss) continue;
    const { week } = await loadTeamWeek(cid, uid, today);
    if (!week || quietWeek(week)) continue;
    const ref = db().collection('reminderLog').doc(`${cid}__${uid}__teamweek_${week.weekStart}`.replace(/[^A-Za-z0-9_-]/g, '_'));
    if ((await ref.get()).exists) continue;
    const mail = weeklyEmail(boss.name, week, await introFor(cid, uid, week));
    await notify(cid, [boss.email], mail.subject, mail.body);
    await ref.set({ companyId: cid, uid, key: `teamweek:${week.weekStart}`, lastSent: today, at: nowIso() });
    emails++;
  }
  return { managers: bosses.size, emails };
}
