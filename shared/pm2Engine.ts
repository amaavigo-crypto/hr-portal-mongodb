/**
 * Performance 2: the rules that sit on top of Performance (PM) reviews. Pure functions, no database.
 *
 *   config snapshot   each calibration cycle freezes the company's settings; later edits apply to the NEXT cycle
 *   bands             per-company score thresholds (names are the company's own words)
 *   calibration       a reasoned, audited adjustment per person; the original score is never overwritten
 *   increments        band -> allowed increment range; a recommendation outside the range is refused
 *   goals evidence    OKR progress gives a SUGGESTED rating; a person must confirm it
 *   360 feedback      anonymity: no averages or comments until enough raters have answered; raters are never named
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ settings

export interface Band { name: string; min: number }
export interface IncrementRule { band: string; minPct: number; maxPct: number }
export interface Pm2Config {
  /** Highest threshold first is not required; they are sorted. A score gets the band with the highest `min` it reaches. */
  bands: Band[];
  increments: IncrementRule[];
  /** 'HR_THEN_APPROVER': HR approves, then a second person with pm.approve. 'HR_ONLY': HR approval is final. */
  approval: 'HR_THEN_APPROVER' | 'HR_ONLY';
  threeSixty: {
    enabled: boolean;
    minRaters: number;
    maxRaters: number;
    /** Share (0-100) of the behaviour score that peer feedback may suggest. The manager's rating is never overridden. */
    peerSharePct: number;
  };
  goals: { enabled: boolean };
}

export const DEFAULT_PM2: Pm2Config = {
  bands: [
    { name: 'Outstanding', min: 4.5 },
    { name: 'Exceeds expectations', min: 3.5 },
    { name: 'Meets expectations', min: 2.5 },
    { name: 'Needs improvement', min: 1.5 },
    { name: 'Unsatisfactory', min: 1 },
  ],
  increments: [
    { band: 'Outstanding', minPct: 12, maxPct: 20 },
    { band: 'Exceeds expectations', minPct: 8, maxPct: 12 },
    { band: 'Meets expectations', minPct: 4, maxPct: 8 },
    { band: 'Needs improvement', minPct: 0, maxPct: 3 },
    { band: 'Unsatisfactory', minPct: 0, maxPct: 0 },
  ],
  approval: 'HR_THEN_APPROVER',
  threeSixty: { enabled: true, minRaters: 3, maxRaters: 8, peerSharePct: 25 },
  goals: { enabled: true },
};

const numOr = (v: unknown, d: number) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const text = (v: unknown, max: number) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim().slice(0, max));

/** Checks what HR typed and returns a clean config, or a sentence saying what to fix. */
export function cleanConfig(input: any, base: Pm2Config = DEFAULT_PM2): { config?: Pm2Config; error?: string } {
  const src = input && typeof input === 'object' ? input : {};
  const bandsIn = Array.isArray(src.bands) ? src.bands : base.bands;
  const bands: Band[] = bandsIn.map((b: any) => ({ name: text(b?.name, 40), min: numOr(b?.min, NaN) }));
  if (bands.length < 2 || bands.length > 8) return { error: 'Use between 2 and 8 bands.' };
  if (bands.some((b) => !b.name)) return { error: 'Every band needs a name.' };
  if (new Set(bands.map((b) => b.name.toLowerCase())).size !== bands.length) return { error: 'Two bands have the same name.' };
  if (bands.some((b) => !Number.isFinite(b.min) || b.min < 1 || b.min > 5)) return { error: 'Band thresholds must be scores from 1 to 5.' };
  if (new Set(bands.map((b) => b.min)).size !== bands.length) return { error: 'Two bands start at the same score.' };
  bands.sort((a, b) => b.min - a.min);
  if (bands[bands.length - 1].min !== 1) return { error: 'The lowest band must start at 1 so every score has a band.' };

  const incIn = Array.isArray(src.increments) ? src.increments : base.increments;
  const increments: IncrementRule[] = bands.map((b) => {
    const r = incIn.find((x: any) => text(x?.band, 40) === b.name) || {};
    return { band: b.name, minPct: numOr((r as any).minPct, 0), maxPct: numOr((r as any).maxPct, 0) };
  });
  for (const r of increments) {
    if (r.minPct < 0 || r.maxPct > 100 || r.minPct > r.maxPct) return { error: `"${r.band}": the increment range is not valid (0 to 100, lowest first).` };
  }

  const approval = src.approval === 'HR_ONLY' ? 'HR_ONLY' : src.approval === 'HR_THEN_APPROVER' ? 'HR_THEN_APPROVER' : base.approval;
  const t = src.threeSixty && typeof src.threeSixty === 'object' ? src.threeSixty : {};
  const minRaters = Math.round(numOr(t.minRaters, base.threeSixty.minRaters));
  const maxRaters = Math.round(numOr(t.maxRaters, base.threeSixty.maxRaters));
  const peerSharePct = numOr(t.peerSharePct, base.threeSixty.peerSharePct);
  if (minRaters < 3) return { error: 'At least 3 raters are needed before results are shown, otherwise people can be guessed.' };
  if (maxRaters < minRaters || maxRaters > 20) return { error: 'The most raters must be at least the minimum, and no more than 20.' };
  if (peerSharePct < 0 || peerSharePct > 50) return { error: 'Peer feedback can shape at most 50% of the behaviour score.' };
  const g = src.goals && typeof src.goals === 'object' ? src.goals : {};
  return {
    config: {
      bands, increments, approval,
      threeSixty: { enabled: t.enabled === undefined ? base.threeSixty.enabled : !!t.enabled, minRaters, maxRaters, peerSharePct },
      goals: { enabled: g.enabled === undefined ? base.goals.enabled : !!g.enabled },
    },
  };
}

// ------------------------------------------------------------------ bands and calibration

export function bandFor(score: number | null | undefined, bands: Band[]): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'Not scored';
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return (sorted.find((b) => score >= b.min) || sorted[sorted.length - 1]).name;
}

export interface CalChange { uid: string; from: number; to: number; reason: string; by: string; at: string }

/** A calibrated score: the last change for that person, else the original. */
export const calibratedScore = (original: number | null, changes: CalChange[], uid: string): number | null => {
  const mine = changes.filter((c) => c.uid === uid);
  return mine.length ? mine[mine.length - 1].to : original;
};

export function adjustmentProblem(to: unknown, reason: unknown): string | null {
  const n = Number(to);
  if (to === '' || to === null || to === undefined || !Number.isFinite(n) || n < 1 || n > 5) return 'The calibrated score must be between 1 and 5.';
  if (text(reason, 400).length < 10) return 'Write the reason for the change (a sentence). It is kept on the record.';
  return null;
}

export function distribution(scores: (number | null)[], bands: Band[]): { band: string; count: number; pct: number }[] {
  const real = scores.filter((s): s is number => s !== null && Number.isFinite(s));
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.map((b) => {
    const count = real.filter((s) => bandFor(s, bands) === b.name).length;
    return { band: b.name, count, pct: real.length ? Math.round((count * 100) / real.length) : 0 };
  });
}

// ------------------------------------------------------------------ increments

export const ruleFor = (band: string, rules: IncrementRule[]) => rules.find((r) => r.band === band) || null;

export function incrementProblem(pct: unknown, band: string, rules: IncrementRule[]): string | null {
  const n = Number(pct);
  if (pct === '' || pct === null || pct === undefined || !Number.isFinite(n)) return 'Enter the increment as a percentage.';
  const r = ruleFor(band, rules);
  if (!r) return `No increment rule exists for "${band}".`;
  if (n < r.minPct || n > r.maxPct) return `For "${band}" the allowed increment is ${r.minPct}% to ${r.maxPct}%. ${n}% is outside it.`;
  return null;
}

/** Every amount scaled by the same percentage, to the paisa. Payroll still validates and applies it. */
export function scaleAmounts(amounts: Record<string, number>, pct: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(amounts)) out[k] = r2(Number(v || 0) * (1 + pct / 100));
  return out;
}

/** First day of the month after `iso`, or `iso` itself if it already is a first. */
export function nextFirstOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const d = Number(iso.slice(8, 10));
  if (d === 1) return iso;
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

export type IncStatus = 'RECOMMENDED' | 'HR_APPROVED' | 'APPROVED' | 'REJECTED' | 'SENT';
/** Where an approval goes next. Returns null when nothing more is needed. */
export function nextIncStatus(current: IncStatus, approval: Pm2Config['approval'], isHr: boolean, isApprover: boolean): { next?: IncStatus; error?: string } {
  if (current === 'RECOMMENDED') {
    if (!isHr) return { error: 'HR approves first.' };
    return { next: approval === 'HR_ONLY' ? 'APPROVED' : 'HR_APPROVED' };
  }
  if (current === 'HR_APPROVED') {
    if (!isApprover) return { error: 'This needs the second approver (someone with approval rights).' };
    return { next: 'APPROVED' };
  }
  return { error: 'Nothing is waiting for approval.' };
}

// ------------------------------------------------------------------ goals as evidence

/** Progress 0-100 -> a rating 1-5 to SUGGEST. Never stored as the rating until a reviewer confirms. */
export function suggestRating(progressPct: number | null): number | null {
  if (progressPct === null || !Number.isFinite(progressPct)) return null;
  return Math.max(1, Math.min(5, Math.round((Math.max(0, Math.min(100, progressPct)) / 100) * 5)));
}

// ------------------------------------------------------------------ 360 feedback

export interface Response360 { ratings: Record<string, number | 'NO'>; comment: string }

export interface Aggregate360 {
  requested: number;
  responded: number;
  /** True once enough people answered. Until then nothing but the counts is returned. */
  enough: boolean;
  average: number | null;
  byCompetency: { id: string; average: number | null; answers: number }[];
  comments: string[];
}

/** Deterministic shuffle so comment order does not follow the order people answered. */
function shuffled<T>(list: T[], seed: string): T[] {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function aggregate360(responses: Response360[], requested: number, minRaters: number, competencyIds: string[], seed = ''): Aggregate360 {
  const responded = responses.length;
  const enough = responded >= minRaters;
  if (!enough) return { requested, responded, enough: false, average: null, byCompetency: [], comments: [] };
  const byCompetency = competencyIds.map((id) => {
    const vals = responses.map((r) => r.ratings[id]).filter((v): v is number => typeof v === 'number');
    // A competency only shows an average when enough people rated it, so a single "not observed" cannot expose the others.
    return { id, average: vals.length >= minRaters ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null, answers: vals.length };
  });
  const shown = byCompetency.filter((x) => x.average !== null) as { average: number }[];
  const average = shown.length ? r2(shown.reduce((a, b) => a + b.average, 0) / shown.length) : null;
  const comments = shuffled(responses.map((r) => r.comment.trim()).filter(Boolean), seed);
  return { requested, responded, enough: true, average, byCompetency, comments };
}

/** What peer feedback suggests for the behaviour score. The manager's own rating stays the record. */
export function blendBehaviour(manager: number | null, peerAverage: number | null, peerSharePct: number): number | null {
  if (manager === null) return null;
  if (peerAverage === null || peerSharePct <= 0) return manager;
  return r2(manager * (1 - peerSharePct / 100) + peerAverage * (peerSharePct / 100));
}

export function panelProblem(subject: string, raters: string[], cfg: Pm2Config['threeSixty']): string | null {
  const uniq = new Set(raters);
  if (uniq.size !== raters.length) return 'The same person is listed twice.';
  if (uniq.has(subject)) return 'A person cannot rate themselves in the 360.';
  if (raters.length < cfg.minRaters) return `Choose at least ${cfg.minRaters} people. With fewer, the answers could be traced back to individuals.`;
  if (raters.length > cfg.maxRaters) return `Choose at most ${cfg.maxRaters} people.`;
  return null;
}
