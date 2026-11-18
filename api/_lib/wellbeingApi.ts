/**
 * Wellbeing games: GET/POST /api/leave/wellbeing-<action> (it shares the leave serverless function, like Home, payroll and people do,
 * because Vercel Hobby allows only 12 functions).
 *
 * Two audiences, kept apart on purpose:
 *   players   me, consent, start, finish, progress, forget-me     fun scores, streaks, personal bests. Never a skill number.
 *   HR        overview, people, person, audit, roles, save-role,   skill pictures. Groups of MIN_GROUP or more only; one person's
 *             reset-role, settings, save-settings                  picture needs its own permission and every open is logged.
 *
 * What makes the numbers trustworthy: a session starts with a seed from the server, the browser plays that seed, and on finish the
 * server replays the same seed against what was sent (shared/wellbeingEngine.ts) and works out points and skills itself.
 * Nothing a browser calculates is stored.
 *
 * Server-only collections (closed to browsers by firestore.rules): wbConsent, wbSessions, wbDaily, wbRoleProfiles, wbSettings, wbAudit.
 */
import { randomBytes } from 'node:crypto';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasAnyPerm } from '../../shared/permissions.js';
import { istToday } from '../../shared/leaveEngine.js';
import {
  CONSENT_VERSION, DEFAULT_DAILY_CAP, GAMES, GAME_IDS, MAX_DAILY_CAP, MIN_GROUP, MIN_PLAYS, SESSION_MAX_MS, SKILL_IDS, SKILLS,
  addDaysIso, cleanWeights, defaultWeights, gamesFor, isGameId, mean, scoreSession, snapshotOf, streakOf, titleKey,
  type GameId, type SkillId, type Snapshot, type Weights,
} from '../../shared/wellbeingEngine.js';
import { LeaveError, audit, db, loadPeople, nowIso, personByUid, str, type Person } from './leaveCore.js';

export interface WellbeingRequest { method: string; action: string; query: Record<string, any>; body: any; headers: Record<string, any> }
interface Result { status: number; json: any }
const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
const clean = (v: unknown) => JSON.parse(JSON.stringify(v));

interface Who { ctx: AuthContext; cid: string; perms: string[]; isAdmin: boolean; name: string; view: boolean; viewIndividual: boolean; manage: boolean }

async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new LeaveError(403, 'Open this as a company user.');
  const p = ctx.perms;
  const admin = ctx.isCompanyAdmin;
  return {
    ctx, cid: ctx.companyId, perms: p, isAdmin: admin, name: ctx.email,
    view: admin || hasAnyPerm(p, ['wellbeing.view', 'wellbeing.view_individual', 'wellbeing.manage']),
    viewIndividual: admin || hasAnyPerm(p, ['wellbeing.view_individual']),
    manage: admin || hasAnyPerm(p, ['wellbeing.manage']),
  };
}

// ------------------------------------------------------------------ data

interface Settings { enabledGames: GameId[]; dailyCap: number }
async function loadSettings(cid: string): Promise<Settings> {
  const s = await db().collection('wbSettings').doc(cid).get();
  const d: any = s.exists ? s.data() : {};
  const enabled = Array.isArray(d.enabledGames) ? (d.enabledGames as unknown[]).filter(isGameId) : GAME_IDS;
  const cap = Number(d.dailyCap);
  return { enabledGames: enabled, dailyCap: Number.isFinite(cap) ? Math.min(MAX_DAILY_CAP, Math.max(1, Math.round(cap))) : DEFAULT_DAILY_CAP };
}

interface Consent { answered: boolean; optedIn: boolean }
async function loadConsent(cid: string, uid: string): Promise<Consent> {
  const s = await db().collection('wbConsent').doc(`${cid}__${uid}`).get();
  const d: any = s.exists ? s.data() : null;
  // A newer notice means the person is asked again.
  if (!d || Number(d.version) !== CONSENT_VERSION) return { answered: false, optedIn: false };
  return { answered: true, optedIn: d.optedIn === true };
}

async function allConsents(cid: string): Promise<Set<string>> {
  const snap = await db().collection('wbConsent').where('companyId', '==', cid).get();
  const set = new Set<string>();
  for (const d of snap.docs) { const x: any = d.data(); if (x.optedIn === true && Number(x.version) === CONSENT_VERSION) set.add(String(x.uid)); }
  return set;
}

interface Session {
  id: string; companyId: string; uid: string; game: GameId; gameVersion: number; seed: string; status: 'STARTED' | 'DONE';
  startedAt: string; finishedAt?: string; points?: number; skills?: Partial<Record<SkillId, number | null>>; metrics?: Record<string, number>; highlight?: string;
}
const asSession = (d: any): Session => ({ ...(d.data() as any), id: d.id });

async function userSessions(cid: string, uid: string): Promise<Session[]> {
  const snap = await db().collection('wbSessions').where('companyId', '==', cid).where('uid', '==', uid).get();
  return snap.docs.map(asSession).filter((s) => s.status === 'DONE');
}
async function companySessions(cid: string): Promise<Session[]> {
  const snap = await db().collection('wbSessions').where('companyId', '==', cid).get();
  return snap.docs.map(asSession).filter((s) => s.status === 'DONE');
}

async function playDays(cid: string, uid: string): Promise<{ days: string[]; counts: Map<string, number> }> {
  const snap = await db().collection('wbDaily').where('companyId', '==', cid).where('uid', '==', uid).get();
  const counts = new Map<string, number>();
  for (const d of snap.docs) { const x: any = d.data(); if (x.day) counts.set(String(x.day), Number(x.count) || 0); }
  return { days: [...counts.keys()], counts };
}

async function roleWeights(cid: string, title: string, department: string): Promise<{ weights: Weights; source: 'custom' | 'default'; matched: string }> {
  const key = titleKey(title);
  if (key) {
    const s = await db().collection('wbRoleProfiles').doc(`${cid}__${key}`).get();
    if (s.exists) return { weights: cleanWeights((s.data() as any).weights), source: 'custom', matched: 'Set by HR' };
  }
  const d = defaultWeights(title, department);
  return { weights: d.weights, source: 'default', matched: d.matched };
}

const bestByGame = (sessions: Session[]): Record<string, number> => {
  const best: Record<string, number> = {};
  for (const s of sessions) best[s.game] = Math.max(best[s.game] || 0, Number(s.points) || 0);
  return best;
};

// ------------------------------------------------------------------ players

async function me(w: Who): Promise<Result> {
  const today = istToday();
  const [settings, consent, person, sessions, days] = await Promise.all([
    loadSettings(w.cid), loadConsent(w.cid, w.ctx.uid), personByUid(w.cid, w.ctx.uid), userSessions(w.cid, w.ctx.uid), playDays(w.cid, w.ctx.uid),
  ]);
  const rw = await roleWeights(w.cid, person?.title || '', person?.department || '');
  const best = bestByGame(sessions);
  const order = gamesFor(rw.weights, settings.enabledGames, today);
  const plays = days.counts.get(today) || 0;
  const recent = [...sessions].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 8)
    .map((s) => ({ id: s.id, game: s.game, points: s.points || 0, highlight: s.highlight || '', at: s.finishedAt }));
  return ok({
    consent: { answered: consent.answered, optedIn: consent.optedIn, version: CONSENT_VERSION },
    games: order.map((id) => ({ id, name: GAMES[id].name, tagline: GAMES[id].tagline, minutes: GAMES[id].minutes, best: best[id] || 0, version: GAMES[id].version })),
    today: { plays, cap: settings.dailyCap, left: Math.max(0, settings.dailyCap - plays) },
    streak: streakOf(days.days, today),
    recent,
    access: { view: w.view, viewIndividual: w.viewIndividual, manage: w.manage },
  });
}

async function progress(w: Who): Promise<Result> {
  const today = istToday();
  const [sessions, days] = await Promise.all([userSessions(w.cid, w.ctx.uid), playDays(w.cid, w.ctx.uid)]);
  const history = [...sessions].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 40)
    .map((s) => ({ id: s.id, game: s.game, points: s.points || 0, highlight: s.highlight || '', at: s.finishedAt }));
  const calendar: { day: string; plays: number }[] = [];
  for (let i = 27; i >= 0; i--) { const day = addDaysIso(today, -i); calendar.push({ day, plays: days.counts.get(day) || 0 }); }
  const bestStreak = (() => {
    const set = [...days.days].sort();
    let best = 0, run = 0, prev = '';
    for (const d of set) { run = prev && addDaysIso(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    return best;
  })();
  return ok({
    bests: bestByGame(sessions), plays: sessions.length, streak: streakOf(days.days, today), bestStreak, calendar, history,
    games: GAME_IDS.map((id) => ({ id, name: GAMES[id].name })),
  });
}

async function consentAction(w: Who, body: any): Promise<Result> {
  if (typeof body?.optIn !== 'boolean') return fail(400, 'Choose whether your games are recorded.');
  await db().collection('wbConsent').doc(`${w.cid}__${w.ctx.uid}`).set({
    companyId: w.cid, uid: w.ctx.uid, optedIn: body.optIn, version: CONSENT_VERSION, at: nowIso(),
  });
  return ok({ optedIn: body.optIn });
}

async function start(w: Who, body: any): Promise<Result> {
  const game = body?.game;
  if (!isGameId(game)) return fail(400, 'Choose a game.');
  const [settings, consent] = await Promise.all([loadSettings(w.cid), loadConsent(w.cid, w.ctx.uid)]);
  if (!settings.enabledGames.includes(game)) return fail(400, 'This game is not switched on.');
  if (!consent.answered) return fail(400, 'Choose whether your games are recorded first.');
  const today = istToday();
  const ref = db().collection('wbDaily').doc(`${w.cid}__${w.ctx.uid}__${today}`);
  const taken = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number((snap.data() as any).count) || 0 : 0;
    if (count >= settings.dailyCap) return -1;
    tx.set(ref, { companyId: w.cid, uid: w.ctx.uid, day: today, count: count + 1 });
    return count + 1;
  });
  if (taken < 0) return fail(429, 'You have had your plays for today. Come back tomorrow.');
  const seed = randomBytes(8).toString('hex');
  let sessionId: string | null = null;
  if (consent.optedIn) {
    const sref = db().collection('wbSessions').doc();
    await sref.set({ companyId: w.cid, uid: w.ctx.uid, game, gameVersion: GAMES[game].version, seed, status: 'STARTED', startedAt: nowIso() });
    sessionId = sref.id;
  }
  return ok({ sessionId, seed, recorded: consent.optedIn, today: { plays: taken, cap: settings.dailyCap, left: Math.max(0, settings.dailyCap - taken) } });
}

async function finish(w: Who, body: any): Promise<Result> {
  const id = str(body?.sessionId, 80);
  if (!id) return fail(400, 'This session was not recorded.');
  const ref = db().collection('wbSessions').doc(id);
  const snap = await ref.get();
  const s: any = snap.exists ? snap.data() : null;
  if (!s || s.companyId !== w.cid || s.uid !== w.ctx.uid) return fail(404, 'That session was not found.');
  if (s.status !== 'STARTED') return fail(409, 'That session is already finished.');
  const elapsed = Date.now() - Date.parse(s.startedAt);
  if (elapsed > SESSION_MAX_MS) return fail(410, 'That session took too long and was not counted.');
  if (elapsed < 10_000) return fail(400, 'That session was too short to count.');
  const out = scoreSession(s.game, s.seed, body?.payload);
  if (!out.ok) return fail(400, out.error || 'The session data is not valid.');
  const before = bestByGame(await userSessions(w.cid, w.ctx.uid))[s.game] || 0;
  const trials = body?.payload?.results ?? body?.payload?.attempts ?? [];
  await ref.set(clean({ ...s, status: 'DONE', finishedAt: nowIso(), points: out.points, skills: out.skills, metrics: out.metrics, highlight: out.highlight, trials }));
  const [settings, days] = await Promise.all([loadSettings(w.cid), playDays(w.cid, w.ctx.uid)]);
  const today = istToday();
  const plays = days.counts.get(today) || 0;
  return ok({
    points: out.points, highlight: out.highlight, previousBest: before, newBest: out.points > before,
    today: { plays, cap: settings.dailyCap, left: Math.max(0, settings.dailyCap - plays) }, streak: streakOf(days.days, today),
  });
}

/** Withdrawing consent is not enough on its own: this deletes what was recorded about the person. */
async function forgetMe(w: Who): Promise<Result> {
  const snap = await db().collection('wbSessions').where('companyId', '==', w.cid).where('uid', '==', w.ctx.uid).get();
  for (const d of snap.docs) await d.ref.delete();
  await db().collection('wbConsent').doc(`${w.cid}__${w.ctx.uid}`).set({ companyId: w.cid, uid: w.ctx.uid, optedIn: false, version: CONSENT_VERSION, at: nowIso() });
  return ok({ deleted: snap.docs.length });
}

// ------------------------------------------------------------------ HR: groups

interface Member { person: Person; snapshot: Snapshot; weights: Weights; sessions: Session[] }

async function members(cid: string): Promise<{ list: Member[]; people: Person[]; consenting: Set<string> }> {
  const [people, consenting, sessions] = await Promise.all([loadPeople(cid), allConsents(cid), companySessions(cid)]);
  const byUid = new Map<string, Session[]>();
  for (const s of sessions) { if (!consenting.has(s.uid)) continue; byUid.set(s.uid, [...(byUid.get(s.uid) || []), s]); }
  const profiles = await db().collection('wbRoleProfiles').where('companyId', '==', cid).get();
  const custom = new Map<string, Weights>();
  for (const d of profiles.docs) { const x: any = d.data(); custom.set(String(x.titleKey), cleanWeights(x.weights)); }
  const list: Member[] = [];
  for (const p of people) {
    const ss = byUid.get(p.uid);
    if (!ss || !p.active) continue;
    const weights = custom.get(titleKey(p.title)) || defaultWeights(p.title, p.department).weights;
    list.push({ person: p, snapshot: snapshotOf(ss), weights, sessions: ss });
  }
  return { list, people, consenting };
}

const relevantOf = (weights: Weights): SkillId[] => SKILL_IDS.filter((s) => weights[s] > 0);

async function overview(w: Who): Promise<Result> {
  if (!w.view) return fail(403, 'You cannot open Wellbeing results.');
  const { list, people, consenting } = await members(w.cid);
  const active = people.filter((p) => p.active);
  const since = Date.now() - 28 * 86_400_000;
  const recent = list.flatMap((m) => m.sessions).filter((s) => Date.parse(String(s.finishedAt)) >= since);
  const recentPlayers = new Set(recent.map((s) => s.uid));
  const byDept = new Map<string, Member[]>();
  for (const m of list) { const k = m.person.department || 'No department'; byDept.set(k, [...(byDept.get(k) || []), m]); }
  const groups: any[] = [];
  let hidden = 0;
  for (const [name, ms] of [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ms.length < MIN_GROUP) { hidden++; continue; }
    const relevant = SKILL_IDS.filter((s) => ms.filter((m) => m.weights[s] > 0).length * 2 >= ms.length);
    const skills: Record<string, any> = {};
    for (const s of SKILL_IDS) {
      const have = ms.map((m) => m.snapshot[s]).filter((x): x is NonNullable<typeof x> => !!x);
      // An average over a handful of people would point at them, so a skill shows only when MIN_GROUP people have enough plays on it.
      if (have.length < MIN_GROUP) { skills[s] = null; continue; }
      const trends = have.map((x) => x.trend).filter((t): t is number => typeof t === 'number');
      skills[s] = { level: Math.round(mean(have.map((x) => x.level))), members: have.length, trend: trends.length >= MIN_GROUP ? Math.round(mean(trends)) : null };
    }
    groups.push({ name, players: ms.length, relevant, skills });
  }
  const optedIn = active.filter((p) => consenting.has(p.uid)).length;
  return ok({
    participation: { optedIn, people: active.length, percent: active.length ? Math.round((optedIn / active.length) * 100) : 0 },
    players: list.length,
    playsPerWeek: recentPlayers.size ? Math.round((recent.length / 4 / recentPlayers.size) * 10) / 10 : 0,
    groups, hiddenGroups: hidden, minGroup: MIN_GROUP, minPlays: MIN_PLAYS,
    skills: SKILL_IDS.map((id) => ({ id, label: SKILLS[id].label, blurb: SKILLS[id].blurb })),
  });
}

// ------------------------------------------------------------------ HR: one person (permissioned and logged)

async function people(w: Who): Promise<Result> {
  if (!w.viewIndividual) return fail(403, 'You cannot open one person\'s Wellbeing picture.');
  const { list } = await members(w.cid);
  // Names and play counts only. Skill numbers are never in a list, so every look at a person is a logged, deliberate open.
  return ok({ people: list.map((m) => ({ uid: m.person.uid, name: m.person.name, department: m.person.department, title: m.person.title, plays: m.sessions.length }))
    .sort((a, b) => a.name.localeCompare(b.name)) });
}

async function person(w: Who, q: any): Promise<Result> {
  if (!w.viewIndividual) return fail(403, 'You cannot open one person\'s Wellbeing picture.');
  const uid = str(q?.uid, 120);
  const p = uid ? await personByUid(w.cid, uid) : null;
  if (!p) return fail(404, 'That person was not found.');
  if (p.uid === w.ctx.uid) return fail(400, 'Your own results are on your Progress page.');
  const consent = await loadConsent(w.cid, p.uid);
  if (!consent.optedIn) return fail(404, 'This person has not opted in to recorded games.');
  const sessions = await userSessions(w.cid, p.uid);
  const rw = await roleWeights(w.cid, p.title, p.department);
  const snap = snapshotOf(sessions);
  const relevant = relevantOf(rw.weights);
  await db().collection('wbAudit').doc().set({ companyId: w.cid, actorUid: w.ctx.uid, actor: w.ctx.email, action: 'VIEW_PERSON', targetUid: p.uid, target: p.name, at: nowIso() });
  const shown: Record<string, any> = {};
  // Only the skills that matter for this person's role are returned: nothing irrelevant is exposed about them.
  for (const s of relevant) shown[s] = snap[s];
  return ok({
    person: { uid: p.uid, name: p.name, department: p.department, title: p.title },
    plays: sessions.length, lastPlayed: sessions.map((s) => String(s.finishedAt)).sort().pop() || '',
    relevant: relevant.map((id) => ({ id, label: SKILLS[id].label, weight: rw.weights[id] })), skills: shown,
    minPlays: MIN_PLAYS, note: 'Use this for development and team planning, not for pay, promotion or discipline.',
  });
}

async function auditList(w: Who): Promise<Result> {
  if (!w.viewIndividual && !w.manage) return fail(403, 'You cannot open the audit log.');
  const snap = await db().collection('wbAudit').where('companyId', '==', w.cid).get();
  const rows = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))).slice(0, 100)
    .map((r: any) => ({ id: r.id, actor: r.actor, action: r.action, target: r.target, at: r.at }));
  return ok({ rows });
}

// ------------------------------------------------------------------ HR: setup

async function roles(w: Who): Promise<Result> {
  if (!w.manage) return fail(403, 'You cannot set up Wellbeing.');
  const [peopleList, profiles] = await Promise.all([loadPeople(w.cid), db().collection('wbRoleProfiles').where('companyId', '==', w.cid).get()]);
  const custom = new Map<string, Weights>();
  for (const d of profiles.docs) { const x: any = d.data(); custom.set(String(x.titleKey), cleanWeights(x.weights)); }
  const titles = new Map<string, { title: string; count: number; department: string }>();
  for (const p of peopleList.filter((x) => x.active && x.title)) {
    const k = titleKey(p.title);
    const cur = titles.get(k);
    titles.set(k, { title: cur?.title || p.title, count: (cur?.count || 0) + 1, department: cur?.department || p.department });
  }
  const rows = [...titles.entries()].map(([k, t]) => {
    const d = defaultWeights(t.title, t.department);
    const mine = custom.get(k);
    return { title: t.title, people: t.count, source: mine ? 'custom' : 'default', matched: mine ? 'Set by HR' : d.matched, weights: mine || d.weights };
  }).sort((a, b) => b.people - a.people || a.title.localeCompare(b.title));
  return ok({ rows, skills: SKILL_IDS.map((id) => ({ id, label: SKILLS[id].label, blurb: SKILLS[id].blurb })) });
}

async function saveRole(w: Who, body: any): Promise<Result> {
  if (!w.manage) return fail(403, 'You cannot set up Wellbeing.');
  const title = str(body?.title, 120);
  const key = titleKey(title);
  if (!key) return fail(400, 'Choose a designation.');
  const weights = cleanWeights(body?.weights);
  await db().collection('wbRoleProfiles').doc(`${w.cid}__${key}`).set({ companyId: w.cid, titleKey: key, title, weights, updatedAt: nowIso(), updatedBy: w.ctx.email });
  await audit(w.cid, 'wellbeing', key, 'ROLE_PROFILE_SAVED', { name: w.ctx.email, uid: w.ctx.uid }, undefined, weights);
  return ok({ weights });
}

async function resetRole(w: Who, body: any): Promise<Result> {
  if (!w.manage) return fail(403, 'You cannot set up Wellbeing.');
  const key = titleKey(str(body?.title, 120));
  if (!key) return fail(400, 'Choose a designation.');
  await db().collection('wbRoleProfiles').doc(`${w.cid}__${key}`).delete();
  await audit(w.cid, 'wellbeing', key, 'ROLE_PROFILE_RESET', { name: w.ctx.email, uid: w.ctx.uid });
  return ok();
}

async function settingsGet(w: Who): Promise<Result> {
  if (!w.manage) return fail(403, 'You cannot set up Wellbeing.');
  const s = await loadSettings(w.cid);
  return ok({ ...s, maxCap: MAX_DAILY_CAP, games: GAME_IDS.map((id) => ({ id, name: GAMES[id].name, tagline: GAMES[id].tagline, minutes: GAMES[id].minutes })) });
}

async function settingsSave(w: Who, body: any): Promise<Result> {
  if (!w.manage) return fail(403, 'You cannot set up Wellbeing.');
  const enabled = (Array.isArray(body?.enabledGames) ? body.enabledGames : []).filter(isGameId) as GameId[];
  if (!enabled.length) return fail(400, 'Keep at least one game on.');
  const cap = Number(body?.dailyCap);
  if (!Number.isFinite(cap) || cap < 1 || cap > MAX_DAILY_CAP) return fail(400, `The daily limit is between 1 and ${MAX_DAILY_CAP}.`);
  const next = { enabledGames: [...new Set(enabled)], dailyCap: Math.round(cap) };
  await db().collection('wbSettings').doc(w.cid).set({ ...next, companyId: w.cid, updatedAt: nowIso(), updatedBy: w.ctx.email });
  await audit(w.cid, 'wellbeing', w.cid, 'SETTINGS_SAVED', { name: w.ctx.email, uid: w.ctx.uid }, undefined, next);
  return ok(next);
}

// ------------------------------------------------------------------ router

export async function routeWellbeing(r: WellbeingRequest): Promise<Result> {
  try {
    const w = await whoIs(r.headers);
    const get = r.method === 'GET';
    const post = r.method === 'POST';
    switch (r.action) {
      case 'me': return get ? await me(w) : fail(405, 'Use GET.');
      case 'progress': return get ? await progress(w) : fail(405, 'Use GET.');
      case 'consent': return post ? await consentAction(w, r.body) : fail(405, 'Use POST.');
      case 'start': return post ? await start(w, r.body) : fail(405, 'Use POST.');
      case 'finish': return post ? await finish(w, r.body) : fail(405, 'Use POST.');
      case 'forget-me': return post ? await forgetMe(w) : fail(405, 'Use POST.');
      case 'overview': return get ? await overview(w) : fail(405, 'Use GET.');
      case 'people': return get ? await people(w) : fail(405, 'Use GET.');
      case 'person': return get ? await person(w, r.query) : fail(405, 'Use GET.');
      case 'audit': return get ? await auditList(w) : fail(405, 'Use GET.');
      case 'roles': return get ? await roles(w) : fail(405, 'Use GET.');
      case 'save-role': return post ? await saveRole(w, r.body) : fail(405, 'Use POST.');
      case 'reset-role': return post ? await resetRole(w, r.body) : fail(405, 'Use POST.');
      case 'settings': return get ? await settingsGet(w) : fail(405, 'Use GET.');
      case 'save-settings': return post ? await settingsSave(w, r.body) : fail(405, 'Use POST.');
      default: return fail(404, `Unknown wellbeing action: ${r.action}`);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    if (err instanceof LeaveError) return fail(err.status, err.message);
    console.error('[wellbeing] failed:', err);
    return fail(500, 'Wellbeing could not load. Try again.');
  }
}
