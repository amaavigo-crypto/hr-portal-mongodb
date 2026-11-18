/**
 * Wellbeing games: the rules, with no database and no browser. Used by the games (to draw and to score live), by the API
 * (to check what a player sends and to work out the skill numbers) and by the tests.
 *
 * Why the stimuli are generated here: every game is played from a seed the server hands out. The browser and the server run the
 * same generator, so the server can replay a session, check that the answers fit the stimuli the player was given, and
 * recompute every number itself. A score posted from the browser is never trusted.
 *
 * Two kinds of numbers come out of a session:
 *  - points: the fun score the player sees (combos, speed bonuses). Computed by the same code live and on the server.
 *  - skills: the measurement HR sees, taken only from the raw trials (never from points, never from bonuses).
 *
 * Skill numbers are 0 to 100 on fixed reference ranges (NORMS). They compare a person with their own history, not with colleagues.
 * Nothing here ranks people: a skill needs MIN_PLAYS sessions before it is shown, and groups smaller than MIN_GROUP are hidden.
 */

export const MIN_GROUP = 5;
export const MIN_PLAYS = 5;
export const CONSENT_VERSION = 1;
export const DEFAULT_DAILY_CAP = 3;
export const MAX_DAILY_CAP = 10;
/** A started session that is never finished is ignored; a finish after this long is refused. */
export const SESSION_MAX_MS = 30 * 60_000;

export type GameId = 'fruit-catch' | 'echo-beats' | 'fraud-hunter';
export type SkillId = 'reaction' | 'impulse' | 'memory' | 'detail';

export const SKILL_IDS: SkillId[] = ['reaction', 'impulse', 'memory', 'detail'];
export const SKILLS: Record<SkillId, { label: string; blurb: string }> = {
  reaction: { label: 'Reaction speed', blurb: 'How quickly a person responds to a signal.' },
  impulse: { label: 'Impulse control', blurb: 'Holding back when the signal says stop.' },
  memory: { label: 'Working memory', blurb: 'Keeping a sequence in mind and repeating it.' },
  detail: { label: 'Attention to detail', blurb: 'Spotting the one thing that does not add up.' },
};

export interface GameDef { id: GameId; name: string; tagline: string; minutes: number; skills: SkillId[]; version: number }
export const GAMES: Record<GameId, GameDef> = {
  'fruit-catch': { id: 'fruit-catch', name: 'Fruit Catch', tagline: 'Tap the fruit. Leave the bombs.', minutes: 3, skills: ['reaction', 'impulse'], version: 1 },
  'echo-beats': { id: 'echo-beats', name: 'Echo Beats', tagline: 'Listen, watch, and play it back.', minutes: 6, skills: ['memory'], version: 1 },
  'fraud-hunter': { id: 'fraud-hunter', name: 'Fraud Hunter', tagline: 'Find the line that does not add up.', minutes: 8, skills: ['detail'], version: 1 },
};
export const GAME_IDS = Object.keys(GAMES) as GameId[];
export const isGameId = (v: unknown): v is GameId => typeof v === 'string' && (GAME_IDS as string[]).includes(v);

// ------------------------------------------------------------------ small helpers

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = Math.round;
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------ seeded random numbers

export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: small, fast and identical on every machine. */
export function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================================================================== Fruit Catch (go / no-go)

export const FRUIT = { practice: 6, trials: 60, goShare: 0.75, fallMs: 1500, minRt: 150, lanes: 5, kinds: 5 } as const;

export interface FruitTrial { go: boolean; lane: number; kind: number; isiMs: number }
export interface FruitResult { tapped: boolean; rt: number | null }
export type FruitOutcome = 'hit' | 'omission' | 'dodge' | 'commission' | 'anticipation';

/** The sequence of fruit and bombs. No three bombs in a row and no long runs of fruit, so nobody can settle into a rhythm. */
export function fruitPlan(seed: string, n: number = FRUIT.trials): FruitTrial[] {
  const r = rng(`${seed}:fruit`);
  const out: FruitTrial[] = [];
  let goRun = 0, bombRun = 0;
  for (let i = 0; i < n; i++) {
    let go = r() < FRUIT.goShare;
    if (!go && bombRun >= 2) go = true;
    if (go && goRun >= 7) go = false;
    goRun = go ? goRun + 1 : 0;
    bombRun = go ? 0 : bombRun + 1;
    out.push({ go, lane: (r() * FRUIT.lanes) | 0, kind: (r() * FRUIT.kinds) | 0, isiMs: 500 + ((r() * 600) | 0) });
  }
  return out;
}

export function fruitOutcome(plan: FruitTrial, res: FruitResult): FruitOutcome {
  if (res.tapped && res.rt !== null && res.rt < FRUIT.minRt) return 'anticipation';
  if (plan.go) return res.tapped ? 'hit' : 'omission';
  return res.tapped ? 'commission' : 'dodge';
}

/** Points for one trial, and the combo after it. */
export function fruitStep(o: FruitOutcome, rt: number | null, combo: number): { points: number; combo: number } {
  const mult = 1 + Math.min(combo, 10) * 0.1;
  switch (o) {
    case 'hit': return { points: round((100 + round(100 * clamp(((700 - (rt ?? 700)) / 450), 0, 1))) * mult), combo: combo + 1 };
    case 'dodge': return { points: round(40 * mult), combo: combo + 1 };
    case 'commission': return { points: -100, combo: 0 };
    case 'omission': return { points: 0, combo: 0 };
    default: return { points: 0, combo };
  }
}

export interface FruitMetrics {
  trials: number; hits: number; omissions: number; dodges: number; commissions: number; anticipations: number;
  goTrials: number; noGoTrials: number; medianRt: number; rtSpread: number; commissionRate: number; hitRate: number; bestCombo: number; points: number;
}

export function fruitMetrics(plan: FruitTrial[], results: FruitResult[]): FruitMetrics {
  let hits = 0, omissions = 0, dodges = 0, commissions = 0, anticipations = 0, combo = 0, best = 0, points = 0;
  const rts: number[] = [];
  for (let i = 0; i < plan.length; i++) {
    const res = results[i] ?? { tapped: false, rt: null };
    const o = fruitOutcome(plan[i], res);
    const s = fruitStep(o, res.rt, combo);
    points += s.points; combo = s.combo; best = Math.max(best, combo);
    if (o === 'hit') { hits++; rts.push(res.rt as number); }
    else if (o === 'omission') omissions++;
    else if (o === 'dodge') dodges++;
    else if (o === 'commission') commissions++;
    else anticipations++;
  }
  const goTrials = plan.filter((p) => p.go).length;
  const noGoTrials = plan.length - goTrials;
  return {
    trials: plan.length, hits, omissions, dodges, commissions, anticipations, goTrials, noGoTrials,
    medianRt: round(median(rts)), rtSpread: round(sd(rts)),
    commissionRate: noGoTrials ? commissions / noGoTrials : 0, hitRate: goTrials ? hits / goTrials : 0,
    bestCombo: best, points: Math.max(0, points),
  };
}

/** The result a player sends must fit the plan: right length, believable times, no time without a tap. */
export function fruitProblem(plan: FruitTrial[], results: unknown): string | null {
  if (!Array.isArray(results) || results.length !== plan.length) return 'The session is incomplete.';
  for (const r of results as any[]) {
    if (!r || typeof r.tapped !== 'boolean') return 'The session data is not valid.';
    if (r.tapped) { if (!isNum(r.rt) || r.rt < 0 || r.rt > FRUIT.fallMs + 200) return 'The session data is not valid.'; }
    else if (r.rt !== null && r.rt !== undefined) return 'The session data is not valid.';
  }
  return null;
}

export function fruitSkills(m: FruitMetrics): Partial<Record<SkillId, number | null>> {
  return {
    reaction: m.hits >= 10 ? round(100 * clamp((NORMS.reaction.slowMs - m.medianRt) / (NORMS.reaction.slowMs - NORMS.reaction.fastMs), 0, 1)) : null,
    impulse: m.noGoTrials >= 8 ? round(100 * clamp(1 - m.commissionRate / NORMS.impulse.worstRate, 0, 1)) : null,
  };
}

// ================================================================== Echo Beats (sequence memory)

export const ECHO = { pads: 4, startLen: 3, maxAttempts: 14, strikes: 3, maxLen: 16, minTapGapMs: 40 } as const;

/** The pattern for one attempt. Every attempt gets a fresh pattern, so a retry is never the same tune. */
export function echoSequence(seed: string, attempt: number, len: number): number[] {
  const r = rng(`${seed}:echo:${attempt}`);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    let p = (r() * ECHO.pads) | 0;
    if (i > 0 && p === out[i - 1] && r() < 0.6) p = (p + 1 + ((r() * (ECHO.pads - 1)) | 0)) % ECHO.pads;
    out.push(p);
  }
  return out;
}

/** What one attempt sent: the length asked, the pads tapped and when (ms from the start of the player's turn). */
export interface EchoAttempt { len: number; input: number[]; t: number[] }

export interface EchoReplay {
  ok: boolean; error?: string; complete: boolean; span: number; strikes: number; attempts: number;
  correctTaps: number; shownTaps: number; meanGapMs: number; points: number; bestStreak: number;
  rounds: { len: number; success: boolean; meanGapMs: number }[];
}

/** Plays the whole session again from the seed with the game's rules and says whether what was sent is possible. */
export function echoReplay(seed: string, attempts: unknown): EchoReplay {
  const bad = (error: string): EchoReplay => ({ ok: false, error, complete: false, span: 0, strikes: 0, attempts: 0, correctTaps: 0, shownTaps: 0, meanGapMs: 0, points: 0, bestStreak: 0, rounds: [] });
  if (!Array.isArray(attempts) || attempts.length === 0 || attempts.length > ECHO.maxAttempts) return bad('The session data is not valid.');
  let len: number = ECHO.startLen, strikes = 0, span = ECHO.startLen - 1, correctTaps = 0, shownTaps = 0, streak = 0, bestStreak = 0, points = 0;
  const rounds: EchoReplay['rounds'] = [];
  const gaps: number[] = [];
  for (let k = 0; k < attempts.length; k++) {
    if (strikes >= ECHO.strikes || len > ECHO.maxLen) return bad('The session data is not valid.');
    const a = attempts[k] as EchoAttempt;
    if (!a || a.len !== len || !Array.isArray(a.input) || !Array.isArray(a.t) || a.input.length !== a.t.length || a.input.length > len) return bad('The session data is not valid.');
    const seq = echoSequence(seed, k, len);
    let matched = 0;
    for (let i = 0; i < a.input.length; i++) {
      if (!Number.isInteger(a.input[i]) || a.input[i] < 0 || a.input[i] >= ECHO.pads || !isNum(a.t[i]) || a.t[i] < 0 || a.t[i] > 120_000) return bad('The session data is not valid.');
      if (i > 0 && a.t[i] - a.t[i - 1] < ECHO.minTapGapMs) return bad('The session data is not valid.');
      if (a.input[i] === seq[i]) matched++;
      else if (i !== a.input.length - 1) return bad('The session data is not valid.');
    }
    const success = a.input.length === len && matched === len;
    const gapsHere: number[] = [];
    for (let i = 1; i < a.t.length; i++) gapsHere.push(a.t[i] - a.t[i - 1]);
    const meanGap = round(mean(gapsHere));
    gaps.push(...gapsHere);
    correctTaps += matched; shownTaps += len;
    rounds.push({ len, success, meanGapMs: meanGap });
    if (success) {
      span = Math.max(span, len);
      streak++; bestStreak = Math.max(bestStreak, streak);
      const bonus = clamp(round(50 - meanGap / 20), 0, 50);
      points += round((60 * len + bonus) * (1 + Math.min(streak - 1, 8) * 0.1));
      len++;
    } else { strikes++; streak = 0; }
  }
  const finished = strikes >= ECHO.strikes || attempts.length >= ECHO.maxAttempts || len > ECHO.maxLen;
  return { ok: true, complete: finished, span, strikes, attempts: attempts.length, correctTaps, shownTaps, meanGapMs: round(mean(gaps)), points, bestStreak, rounds };
}

export function echoSkills(r: EchoReplay): Partial<Record<SkillId, number | null>> {
  if (!r.ok || !r.complete) return { memory: null };
  const spanScore = 100 * clamp((r.span - 2) / (NORMS.memory.topSpan - 2), 0, 1);
  const acc = r.shownTaps ? r.correctTaps / r.shownTaps : 0;
  return { memory: round(0.85 * spanScore + 0.15 * 100 * acc) };
}

// ================================================================== Fraud Hunter (find the line that does not add up)

export const FRAUD = { docs: 24, rows: 6, cleanShare: 0.25, timeoutMs: 25_000, practice: 3 } as const;
/** Where an error can be: 0 to 5 are the item lines, then the three summary lines. */
export const FRAUD_TARGETS = { subtotal: 6, gst: 7, total: 8 } as const;

export interface InvoiceRow { item: string; qty: number; rate: number; amount: number }
export interface FraudDoc {
  vendor: string; invoiceNo: string; date: string; rows: InvoiceRow[];
  subtotal: number; gstRate: number; gst: number; total: number;
  /** -1 = the invoice is clean. Otherwise the line (0 to 8) that does not add up. */
  errorAt: number;
}

const VENDORS = ['Northwind Supplies', 'Bluepeak Logistics', 'Kestrel Office Co.', 'Harbor & Pine Traders', 'Lumen Print Works', 'Orchid Facility Services', 'Tidewater Cloud', 'Maple Street Catering', 'Ironleaf Hardware', 'Saffron Travel Desk'];
const ITEMS = ['Office chairs', 'Printer toner', 'Courier charges', 'Cloud hosting', 'Laptop sleeves', 'Meeting room hire', 'Whiteboard markers', 'Network cables', 'Team lunch trays', 'Safety signage', 'Desk lamps', 'Archive boxes', 'Software seats', 'Cab vouchers', 'Visiting cards', 'Water cans', 'Monitor stands', 'Cleaning kits', 'Training manuals', 'Badge holders', 'Pantry supplies', 'Extension boards', 'Webcams', 'Notebooks'];
const RATES = [45, 55, 75, 90, 120, 150, 250, 340, 480, 650, 800, 1200];
const MONTHS = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'];

const swapDigits = (n: number, pick: number): number => {
  const s = String(n).split('');
  const idx: number[] = [];
  for (let i = 0; i < s.length - 1; i++) if (s[i] !== s[i + 1]) idx.push(i);
  if (!idx.length) return n + 10;
  const i = idx[pick % idx.length];
  [s[i], s[i + 1]] = [s[i + 1], s[i]];
  const out = Number(s.join(''));
  return out === n || String(out).length !== String(n).length ? n + 10 : out;
};

/** A wrong version of a number. Early documents get obvious mistakes, later ones swapped digits and small slips. Never the same number back. */
function slip(n: number, level: 0 | 1 | 2, r: () => number): number {
  const up = r() < 0.5;
  let delta: number;
  if (level === 0) delta = Math.max(100, round((n * (0.4 + r() * 0.6)) / 10) * 10);
  else if (level === 1) delta = Math.max(30, round((n * (0.08 + r() * 0.12)) / 10) * 10);
  else {
    if (r() < 0.6) { const swapped = swapDigits(n, (r() * 8) | 0); if (swapped !== n) return swapped; }
    delta = 10 + ((r() * 8) | 0) * 10;
  }
  return !up && n - delta >= 10 ? n - delta : n + delta;
}

export function fraudPlan(seed: string, n: number = FRAUD.docs): FraudDoc[] {
  const r = rng(`${seed}:fraud`);
  const docs: FraudDoc[] = [];
  let cleanRun = 0, errRun = 0;
  for (let d = 0; d < n; d++) {
    let clean = r() < FRAUD.cleanShare;
    if (clean && cleanRun >= 1) clean = false;
    if (!clean && errRun >= 4) clean = true;
    cleanRun = clean ? cleanRun + 1 : 0; errRun = clean ? 0 : errRun + 1;
    const level = (d < 8 ? 0 : d < 16 ? 1 : 2) as 0 | 1 | 2;
    const pool = [...ITEMS];
    const rows: InvoiceRow[] = [];
    for (let i = 0; i < FRAUD.rows; i++) {
      const item = pool.splice((r() * pool.length) | 0, 1)[0];
      const qty = 1 + ((r() * 11) | 0);
      const rate = RATES[(r() * RATES.length) | 0];
      rows.push({ item, qty, rate, amount: qty * rate });
    }
    const gstRate = [5, 12, 18][(r() * 3) | 0];
    let errorAt = -1;
    if (!clean) { const pick = r(); errorAt = pick < 0.7 ? (r() * FRAUD.rows) | 0 : pick < 0.8 ? FRAUD_TARGETS.subtotal : pick < 0.9 ? FRAUD_TARGETS.gst : FRAUD_TARGETS.total; }
    // Exactly one line is wrong, and everything after it is worked out from what is printed, so nothing else gives it away.
    if (errorAt >= 0 && errorAt < FRAUD.rows) rows[errorAt].amount = slip(rows[errorAt].amount, level, r);
    const sumRows = rows.reduce((a, x) => a + x.amount, 0);
    let subtotal = sumRows;
    if (errorAt === FRAUD_TARGETS.subtotal) subtotal = slip(sumRows, level, r);
    let gst = round((subtotal * gstRate) / 100);
    if (errorAt === FRAUD_TARGETS.gst) gst = slip(gst, level === 0 ? 1 : level, r);
    let total = subtotal + gst;
    if (errorAt === FRAUD_TARGETS.total) total = slip(total, level, r);
    docs.push({
      vendor: VENDORS[(r() * VENDORS.length) | 0], invoiceNo: `INV-${1000 + ((r() * 8999) | 0)}`,
      date: `${1 + ((r() * 27) | 0)} ${MONTHS[(r() * MONTHS.length) | 0]}`, rows, subtotal, gstRate, gst, total, errorAt,
    });
  }
  return docs;
}

/** choice: 0 to 8 = the line the player flagged, -1 = "all clear", null = ran out of time. */
export interface FraudResult { choice: number | null; ms: number }
export type FraudOutcome = 'found' | 'wrongSpot' | 'falseAlarm' | 'cleared' | 'missed';

export function fraudOutcome(doc: FraudDoc, res: FraudResult): FraudOutcome {
  if (doc.errorAt >= 0) {
    if (res.choice === doc.errorAt) return 'found';
    if (res.choice === null || res.choice === -1) return 'missed';
    return 'wrongSpot';
  }
  if (res.choice === -1) return 'cleared';
  return res.choice === null ? 'missed' : 'falseAlarm';
}

export function fraudStep(o: FraudOutcome, ms: number, combo: number): { points: number; combo: number } {
  const mult = 1 + Math.min(combo, 8) * 0.1;
  const bonus = round(100 * clamp((15_000 - ms) / 11_000, 0, 1));
  if (o === 'found') return { points: round((150 + bonus) * mult), combo: combo + 1 };
  if (o === 'cleared') return { points: round((100 + bonus) * mult), combo: combo + 1 };
  return { points: 0, combo: 0 };
}

export interface FraudMetrics {
  docs: number; errorDocs: number; cleanDocs: number; found: number; wrongSpot: number; falseAlarm: number; cleared: number; missed: number;
  hitRate: number; clearRate: number; medianMs: number; bestCombo: number; points: number;
}

export function fraudMetrics(plan: FraudDoc[], results: FraudResult[]): FraudMetrics {
  const c: Record<FraudOutcome, number> = { found: 0, wrongSpot: 0, falseAlarm: 0, cleared: 0, missed: 0 };
  let combo = 0, best = 0, points = 0;
  const times: number[] = [];
  for (let i = 0; i < plan.length; i++) {
    const res = results[i] ?? { choice: null, ms: FRAUD.timeoutMs };
    const o = fraudOutcome(plan[i], res);
    c[o]++;
    const s = fraudStep(o, res.ms, combo);
    points += s.points; combo = s.combo; best = Math.max(best, combo);
    if (o === 'found' || o === 'cleared') times.push(res.ms);
  }
  const errorDocs = plan.filter((d) => d.errorAt >= 0).length;
  const cleanDocs = plan.length - errorDocs;
  return {
    docs: plan.length, errorDocs, cleanDocs, ...c,
    hitRate: errorDocs ? c.found / errorDocs : 0, clearRate: cleanDocs ? c.cleared / cleanDocs : 0,
    medianMs: round(median(times)), bestCombo: best, points,
  };
}

export function fraudProblem(plan: FraudDoc[], results: unknown): string | null {
  if (!Array.isArray(results) || results.length !== plan.length) return 'The session is incomplete.';
  for (const r of results as any[]) {
    if (!r || !isNum(r.ms) || r.ms < 0 || r.ms > FRAUD.timeoutMs + 2000) return 'The session data is not valid.';
    if (r.choice !== null && !(Number.isInteger(r.choice) && r.choice >= -1 && r.choice <= FRAUD_TARGETS.total)) return 'The session data is not valid.';
  }
  return null;
}

export function fraudSkills(m: FraudMetrics): Partial<Record<SkillId, number | null>> {
  if (m.errorDocs < 6 || m.cleanDocs < 2) return { detail: null };
  // Catching slips and clearing clean invoices, with guessing at zero: waving everything through, or flagging at random, scores 0.
  const informed = clamp(m.hitRate + m.clearRate - 1, 0, 1);
  const timeFactor = clamp(1 - (m.medianMs - NORMS.detail.easyMs) / 40_000, 0.75, 1);
  return { detail: round(100 * informed * timeFactor) };
}

// ================================================================== reference ranges

/** Fixed reference ranges. They only turn raw numbers into 0 to 100; they say nothing about other people. */
export const NORMS = {
  reaction: { fastMs: 250, slowMs: 700 },
  impulse: { worstRate: 0.5 },
  memory: { topSpan: 9 },
  detail: { easyMs: 5000 },
} as const;

// ================================================================== one session, checked and scored

export interface SessionOutcome {
  ok: boolean; error?: string; points: number;
  skills: Partial<Record<SkillId, number | null>>;
  metrics: Record<string, number>;
  highlight: string;
}

/** Everything the server does with a finished session: check it against the seed, then score it. */
export function scoreSession(game: GameId, seed: string, payload: any): SessionOutcome {
  const fail = (error: string): SessionOutcome => ({ ok: false, error, points: 0, skills: {}, metrics: {}, highlight: '' });
  if (game === 'fruit-catch') {
    const plan = fruitPlan(seed);
    const problem = fruitProblem(plan, payload?.results);
    if (problem) return fail(problem);
    const m = fruitMetrics(plan, payload.results);
    return { ok: true, points: m.points, skills: fruitSkills(m), metrics: { ...m } as any, highlight: m.bestCombo >= 2 ? `Longest run: ${m.bestCombo} in a row` : `${m.hits} fruit caught` };
  }
  if (game === 'echo-beats') {
    const r = echoReplay(seed, payload?.attempts);
    if (!r.ok) return fail(r.error || 'The session data is not valid.');
    if (!r.complete) return fail('The session is incomplete.');
    const { rounds, ok, error, complete, ...rest } = r;
    return { ok: true, points: r.points, skills: echoSkills(r), metrics: { ...rest } as any, highlight: `Longest pattern: ${r.span}` };
  }
  if (game === 'fraud-hunter') {
    const plan = fraudPlan(seed);
    const problem = fraudProblem(plan, payload?.results);
    if (problem) return fail(problem);
    const m = fraudMetrics(plan, payload.results);
    return { ok: true, points: m.points, skills: fraudSkills(m), metrics: { ...m } as any, highlight: `${m.found} of ${m.errorDocs} slips caught` };
  }
  return fail('Unknown game.');
}

// ================================================================== skills over time (what HR sees)

export interface SkillSnapshot { level: number; n: number; spread: number; trend: number | null; confidence: 'low' | 'ok' }
export type Snapshot = Record<SkillId, SkillSnapshot | null>;

/** A person's skill picture from their finished sessions. A skill shows only after MIN_PLAYS sessions that measured it. */
export function snapshotOf(sessions: { finishedAt?: string; skills?: Partial<Record<SkillId, number | null>> }[]): Snapshot {
  const ordered = [...sessions].sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  const out = {} as Snapshot;
  for (const id of SKILL_IDS) {
    const vals = ordered.map((s) => s.skills?.[id]).filter((v): v is number => isNum(v)).slice(-10);
    if (vals.length < MIN_PLAYS) { out[id] = null; continue; }
    const trend = vals.length >= 6 ? round(mean(vals.slice(-3)) - mean(vals.slice(-6, -3))) : null;
    out[id] = { level: round(mean(vals)), n: vals.length, spread: round(sd(vals) / Math.sqrt(vals.length)), trend, confidence: vals.length >= 10 ? 'ok' : 'low' };
  }
  return out;
}

// ================================================================== roles

export type Weights = Record<SkillId, number>;
export const NO_WEIGHTS: Weights = { reaction: 0, impulse: 0, memory: 0, detail: 0 };

interface RoleRule { name: string; words: string[]; weights: Weights }
/** Starting points only. HR edits them per designation; nothing here is a finding about what a job needs. */
const ROLE_RULES: RoleRule[] = [
  { name: 'Finance and accounts', words: ['finance', 'account', 'payroll', 'audit', 'bookkeep', 'billing', 'tax'], weights: { reaction: 0, impulse: 1, memory: 1, detail: 3 } },
  { name: 'Compliance and quality', words: ['compliance', 'quality', 'qc', 'legal', 'document', 'review', 'governance'], weights: { reaction: 0, impulse: 2, memory: 1, detail: 3 } },
  { name: 'Recruiting', words: ['recruit', 'talent', 'sourcing'], weights: { reaction: 2, impulse: 1, memory: 1, detail: 1 } },
  { name: 'HR and operations', words: ['hr', 'people', 'admin', 'operations', 'coordinator', 'office'], weights: { reaction: 2, impulse: 0, memory: 2, detail: 1 } },
  { name: 'Engineering and analysis', words: ['develop', 'engineer', 'analyst', 'data', 'software', 'programmer', 'tech'], weights: { reaction: 0, impulse: 1, memory: 3, detail: 2 } },
  { name: 'Support and sales', words: ['support', 'customer', 'service', 'sales', 'executive', 'associate'], weights: { reaction: 2, impulse: 2, memory: 1, detail: 1 } },
];
const LEADERSHIP = ['manager', 'head', 'director', 'lead', 'founder', 'ceo', 'chief', 'president'];

const hasWord = (text: string, w: string) => (w.length <= 3 ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text) : text.includes(w));

export function defaultWeights(title: string, department = ''): { weights: Weights; matched: string } {
  const text = `${title} ${department}`.toLowerCase();
  const titleText = title.toLowerCase();
  for (const rule of ROLE_RULES) if (rule.words.some((w) => hasWord(titleText, w))) return { weights: { ...rule.weights }, matched: rule.name };
  if (LEADERSHIP.some((w) => hasWord(titleText, w))) return { weights: { ...NO_WEIGHTS }, matched: 'General' };
  for (const rule of ROLE_RULES) if (rule.words.some((w) => hasWord(text, w))) return { weights: { ...rule.weights }, matched: rule.name };
  return { weights: { ...NO_WEIGHTS }, matched: 'General' };
}

export function cleanWeights(raw: any): Weights {
  const out = { ...NO_WEIGHTS };
  for (const id of SKILL_IDS) { const v = Number(raw?.[id]); out[id] = Number.isFinite(v) ? clamp(Math.round(v), 0, 3) : 0; }
  return out;
}

export const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

/** Games in the order a person sees them: the ones that match their role first. With no role match the order turns with the day. */
export function gamesFor(weights: Weights, enabled: GameId[], dayKey: string): GameId[] {
  const score = (g: GameId) => GAMES[g].skills.reduce((a, s) => a + weights[s], 0);
  const list = enabled.filter(isGameId);
  if (list.every((g) => score(g) === 0)) {
    const shift = hashSeed(dayKey) % Math.max(1, list.length);
    return [...list.slice(shift), ...list.slice(0, shift)];
  }
  return [...list].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

// ================================================================== days and streaks

export const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Days in a row with at least one play, counting back from today (or from yesterday, so the streak survives until tonight). */
export function streakOf(playDays: string[], today: string): number {
  const set = new Set(playDays);
  let day = set.has(today) ? today : addDaysIso(today, -1);
  let n = 0;
  while (set.has(day)) { n++; day = addDaysIso(day, -1); }
  return n;
}
