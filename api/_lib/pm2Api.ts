/**
 * Performance 2: calibration, increments, goals as evidence and 360 feedback, on top of the Performance (PM) reviews.
 * Reached as /api/pm/p2-<action> (pmApi.ts spreads PM2_ROUTES into its table, so no new serverless function is needed).
 *
 * Collections (server-only, every record carries companyId):
 *   pm2Config        one per company: bands, increment rules, 360 rules (versioned)
 *   pm2Calibrations  one per company per cycle: the config SNAPSHOT for that cycle, every score change with its reason, OPEN/FINAL
 *   pm2Increments    one per person per cycle: recommendation -> approvals -> payroll hand-off
 *   pm2Panels        one per person per cycle: who was asked for 360 feedback
 *   pm2Feedback      one per rater per panel: the answers. Raters are never returned by any normal call.
 *   pm2GoalChecks    a reviewer's confirmation of the rating suggested by goal progress
 *
 * Rules that matter:
 *   - An original review score is never overwritten; calibration keeps a reasoned change log.
 *   - Config edits apply to the NEXT cycle; an open cycle keeps its snapshot unless HR amends it (audited, new version).
 *   - An increment is only a proposal. Payroll applies a salary change through its own revision flow.
 *   - Goal progress only SUGGESTS a rating. Nothing becomes a rating until a person confirms it.
 *   - 360: no averages or comments until enough raters answered; comments are unattributed; rater identity is HR-audit only.
 */
import {
  DEFAULT_PM2, adjustmentProblem, aggregate360, bandFor, blendBehaviour, calibratedScore, cleanConfig, distribution, incrementProblem,
  nextFirstOfMonth, nextIncStatus, panelProblem, ruleFor, scaleAmounts, suggestRating, type CalChange, type IncStatus, type Pm2Config,
} from '../../shared/pm2Engine.js';
import { isDate, istToday } from '../../shared/pmEngine.js';
import { objectiveProgress } from '../../shared/talentCycle.js';
import { grossOf, loadPayrollSettings, loadStructures } from './payrollKit.js';
import {
  active, audit, bad, canSee, db, denied, get, hasReports, hrUids, isManagerOf, list, managerOf, notFound, nowIso, ok, put, settingsOf, str, tell,
  type C, type Doc, type Result, type Route,
} from './pmCore.js';

const calId = (cid: string, cycle: string) => `${cid}_${cycle}`;
const subId = (cid: string, cycle: string, uid: string) => `${cid}_${cycle}_${uid}`;
const isCycle = (s: string) => /^\d{4}-Q[1-4]$/.test(s);
const conflict = (m: string): Result => ({ status: 409, json: { success: false, error: m } });

// ------------------------------------------------------------------ settings

async function configOf(cid: string): Promise<{ config: Pm2Config; version: number }> {
  const d = await get(cid, 'p2Config', cid);
  if (!d) return { config: DEFAULT_PM2, version: 0 };
  return { config: cleanConfig(d.config, DEFAULT_PM2).config || DEFAULT_PM2, version: Number(d.version) || 1 };
}

async function home(c: C): Promise<Result> {
  const { config } = await configOf(c.cid);
  const panels = await list(c.cid, 'p2Panel');
  const mine = panels.filter((p) => p.status === 'APPROVED' && (p.raters || []).some((r: any) => r.uid === c.ctx.uid));
  const done = new Set((await list(c.cid, 'p2Fb')).filter((f) => f.raterUid === c.ctx.uid).map((f) => f.panelId));
  return ok({
    isHr: c.isHr, isApprover: c.isApprover, isManager: hasReports(c, c.ctx.uid), threeSixty: config.threeSixty.enabled, goals: config.goals.enabled,
    toGive: mine.filter((p) => !done.has(p.id)).length, today: istToday(),
  });
}

async function configGet(c: C): Promise<Result> {
  const { config, version } = await configOf(c.cid);
  const s = await settingsOf(c.cid);
  return ok({ config, version, competencies: s.competencies.map((x) => ({ id: x.id, name: x.name })) });
}

async function configSave(c: C, b: any): Promise<Result> {
  const r = cleanConfig(b.config, DEFAULT_PM2);
  if (!r.config) return bad(r.error!);
  const prev = await configOf(c.cid);
  const version = prev.version + 1;
  await put('p2Config', { id: c.cid, companyId: c.cid, config: r.config, version, savedBy: c.who });
  await audit(c, `p2config`, 'P2_CONFIG_SAVED', `Version ${version}. Bands: ${r.config.bands.map((x) => `${x.name} from ${x.min}`).join(', ')}. Cycles already opened keep the settings they started with.`);
  return ok({ config: r.config, version, message: 'Saved. It applies to calibration cycles you open from now on; open cycles keep their own copy.' });
}

// ------------------------------------------------------------------ calibration

interface CalDoc extends Doc {
  cycleKey: string; status: 'OPEN' | 'FINAL'; snapshot: { version: number; config: Pm2Config; at: string; by: string };
  snapshots: { version: number; config: Pm2Config; at: string; by: string; replacedAt: string; reason: string }[]; changes: CalChange[]; finalisedAt?: string; finalisedBy?: string;
}

const cycleOfQuery = (q: any, b: any = {}) => str(q?.cycle || b?.cycle, 7);

async function scoredReviews(c: C, cycle: string): Promise<Doc[]> {
  const rows = await list(c.cid, 'reviews', { cycleKey: cycle });
  return rows.filter((r) => r.score && typeof r.score.overall === 'number');
}

function calView(c: C, cal: CalDoc | null, cfg: Pm2Config, reviews: Doc[]) {
  const changes = cal?.changes || [];
  const rows = reviews.map((r) => {
    const original = r.score.overall as number;
    const calibrated = calibratedScore(original, changes, r.uid) as number;
    const mine = changes.filter((x) => x.uid === r.uid);
    return {
      uid: r.uid, name: r.name, group: c.byUid.get(r.uid)?.department || 'No department', reviewStatus: r.status, original, calibrated,
      originalBand: bandFor(original, cfg.bands), band: bandFor(calibrated, cfg.bands), changes: mine.length, lastReason: mine.length ? mine[mine.length - 1].reason : '',
    };
  }).sort((a, b) => b.calibrated - a.calibrated || a.name.localeCompare(b.name));
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  return {
    rows,
    before: distribution(rows.map((r) => r.original), cfg.bands),
    after: distribution(rows.map((r) => r.calibrated), cfg.bands),
    groups: groups.map((g) => ({ group: g, people: rows.filter((r) => r.group === g).length, after: distribution(rows.filter((r) => r.group === g).map((r) => r.calibrated), cfg.bands) })),
  };
}

async function calGet(c: C, _b: any, q: any): Promise<Result> {
  const cycle = cycleOfQuery(q);
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  const cfg = cal ? cal.snapshot.config : (await configOf(c.cid)).config;
  const view = calView(c, cal, cfg, await scoredReviews(c, cycle));
  return ok({
    cycle, opened: !!cal, status: cal?.status || 'NOT_OPENED', version: cal?.snapshot.version ?? null, config: cfg, changes: (cal?.changes || []).slice(-100).reverse(),
    amended: (cal?.snapshots || []).length, ...view,
  });
}

async function calOpen(c: C, b: any): Promise<Result> {
  const cycle = cycleOfQuery({}, b);
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  const id = calId(c.cid, cycle);
  const prior = await get(c.cid, 'p2Cal', id);
  if (prior) return ok({ already: true });
  if ((await scoredReviews(c, cycle)).length === 0) return conflict('No review in this quarter has a score yet. Open calibration once managers have finished their ratings.');
  const { config, version } = await configOf(c.cid);
  await put('p2Cal', { id, companyId: c.cid, cycleKey: cycle, status: 'OPEN', snapshot: { version, config, at: nowIso(), by: c.who }, snapshots: [], changes: [] });
  await audit(c, id, 'P2_CAL_OPENED', `${cycle}: settings version ${version} frozen for this cycle.`);
  return ok({ message: 'Calibration is open. The current settings are now frozen for this quarter.' });
}

async function calAdjust(c: C, b: any): Promise<Result> {
  const cycle = cycleOfQuery({}, b);
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  if (!cal) return conflict('Open calibration for this quarter first.');
  if (cal.status === 'FINAL') return conflict('This calibration is final. Scores cannot be changed.');
  const uid = str(b.uid, 128);
  const rv = (await scoredReviews(c, cycle)).find((r) => r.uid === uid);
  if (!rv) return notFound('That review');
  if (uid === c.ctx.uid) return denied('You cannot change your own score.');
  const problem = adjustmentProblem(b.to, b.reason);
  if (problem) return bad(problem);
  const to = Math.round(Number(b.to) * 100) / 100;
  const from = calibratedScore(rv.score.overall, cal.changes, uid) as number;
  if (to === from) return bad('That is the same score. Nothing to change.');
  const change: CalChange = { uid, from, to, reason: str(b.reason, 400), by: c.who, at: nowIso() };
  await put('p2Cal', { ...cal, changes: [...cal.changes, change] });
  await audit(c, cal.id, 'P2_CAL_ADJUSTED', `${rv.name}: ${from} to ${to} (${bandFor(from, cal.snapshot.config.bands)} to ${bandFor(to, cal.snapshot.config.bands)}). Reason: ${change.reason}`, uid);
  const mgr = managerOf(c, uid);
  if (mgr) await tell(c, [mgr], `Calibration: ${rv.name}'s score was adjusted`, `${c.who} changed the calibrated score for ${rv.name} (${cycle}) from ${from} to ${to}. Reason: ${change.reason}`);
  return ok({ from, to, band: bandFor(to, cal.snapshot.config.bands) });
}

async function calFinalise(c: C, b: any): Promise<Result> {
  const cycle = cycleOfQuery({}, b);
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  if (!cal) return conflict('Open calibration for this quarter first.');
  if (cal.status === 'FINAL') return ok({ already: true });
  await put('p2Cal', { ...cal, status: 'FINAL', finalisedAt: nowIso(), finalisedBy: c.who });
  await audit(c, cal.id, 'P2_CAL_FINAL', `${cycle}: ${cal.changes.length} change(s). Scores are locked and increments can now be recommended.`);
  return ok({ message: 'Calibration is final. Managers can now recommend increments.' });
}

/** A mid-cycle change of rules. The old copy is kept; the cycle moves to a new version. */
async function calAmend(c: C, b: any): Promise<Result> {
  const cycle = cycleOfQuery({}, b);
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  if (!cal) return conflict('Open calibration for this quarter first.');
  if (cal.status === 'FINAL') return conflict('This calibration is final and cannot be amended.');
  const reason = str(b.reason, 400);
  if (reason.length < 10) return bad('Say why the rules are being changed mid-cycle.');
  const { config, version } = await configOf(c.cid);
  if (version === cal.snapshot.version) return bad('The settings have not changed since this cycle was opened.');
  await put('p2Cal', { ...cal, snapshots: [...cal.snapshots, { ...cal.snapshot, replacedAt: nowIso(), reason }], snapshot: { version, config, at: nowIso(), by: c.who } });
  await audit(c, cal.id, 'P2_CAL_AMENDED', `${cycle}: moved from settings version ${cal.snapshot.version} to ${version}. Reason: ${reason}`);
  return ok({ version });
}

// ------------------------------------------------------------------ increments

interface IncDoc extends Doc {
  cycleKey: string; uid: string; name: string; score: number; band: string; pct: number; minPct: number; maxPct: number; reason: string;
  status: IncStatus; recommendedBy: string; recommendedByUid: string; history: { at: string; by: string; byUid: string; action: string; note: string }[];
  effectiveFrom?: string; revisionId?: string;
}

async function finalCal(c: C, cycle: string): Promise<{ cal?: CalDoc; error?: Result }> {
  if (!isCycle(cycle)) return { error: bad('Choose a quarter like 2026-Q4.') };
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  if (!cal) return { error: conflict('Calibration has not been opened for this quarter.') };
  if (cal.status !== 'FINAL') return { error: conflict('Calibration is not final yet. Increments are recommended after it is locked.') };
  return { cal };
}

async function incList(c: C, _b: any, q: any): Promise<Result> {
  const cycle = cycleOfQuery(q);
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, cycle))) as CalDoc | null;
  if (!cal) return ok({ cycle, ready: false, rows: [], message: 'Calibration has not been opened for this quarter.' });
  const cfg = cal.snapshot.config;
  const props = new Map((await list(c.cid, 'p2Inc', { cycleKey: cycle })).map((p) => [p.uid, p as IncDoc]));
  const manager = hasReports(c, c.ctx.uid);
  const rows = (await scoredReviews(c, cycle))
    .filter((r) => c.isHr || c.isApprover || (manager && isManagerOf(c, r.uid)))
    .map((r) => {
      const score = calibratedScore(r.score.overall, cal.changes, r.uid) as number;
      const band = bandFor(score, cfg.bands);
      const rule = ruleFor(band, cfg.increments);
      const p = props.get(r.uid);
      return { uid: r.uid, name: r.name, score, band, minPct: rule?.minPct ?? 0, maxPct: rule?.maxPct ?? 0, proposal: p ? { id: p.id, pct: p.pct, status: p.status, reason: p.reason, by: p.recommendedBy, history: p.history, effectiveFrom: p.effectiveFrom || '', sent: p.status === 'SENT' } : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ cycle, ready: cal.status === 'FINAL', approval: cfg.approval, rows });
}

async function incRecommend(c: C, b: any): Promise<Result> {
  const cycle = cycleOfQuery({}, b);
  const { cal, error } = await finalCal(c, cycle);
  if (!cal) return error!;
  const uid = str(b.uid, 128);
  const rv = (await scoredReviews(c, cycle)).find((r) => r.uid === uid);
  if (!rv) return notFound('That review');
  if (uid === c.ctx.uid) return denied('You cannot recommend your own increment.');
  if (!c.isHr && !isManagerOf(c, uid)) return denied('Only the manager or HR can recommend an increment.');
  const score = calibratedScore(rv.score.overall, cal.changes, uid) as number;
  const band = bandFor(score, cal.snapshot.config.bands);
  const problem = incrementProblem(b.pct, band, cal.snapshot.config.increments);
  if (problem) return bad(problem);
  const reason = str(b.reason, 400);
  if (reason.length < 10) return bad('Say why this increment (a sentence).');
  const id = subId(c.cid, cycle, uid);
  const prior = (await get(c.cid, 'p2Inc', id)) as IncDoc | null;
  if (prior && !['RECOMMENDED', 'REJECTED'].includes(prior.status)) return conflict('This increment is already approved or sent. It cannot be changed here.');
  const rule = ruleFor(band, cal.snapshot.config.increments)!;
  const entry = { at: nowIso(), by: c.who, byUid: c.ctx.uid, action: 'RECOMMENDED', note: `${b.pct}%: ${reason}` };
  await put('p2Inc', {
    id, companyId: c.cid, cycleKey: cycle, uid, name: rv.name, score, band, pct: Number(b.pct), minPct: rule.minPct, maxPct: rule.maxPct, reason, status: 'RECOMMENDED',
    recommendedBy: c.who, recommendedByUid: c.ctx.uid, history: [...(prior?.history || []), entry],
  });
  await audit(c, id, 'P2_INC_RECOMMENDED', `${rv.name}: ${b.pct}% (${band}, calibrated ${score}). ${reason}`, uid);
  await tell(c, await hrUids(c), `Increment recommended: ${rv.name}`, `${c.who} recommended ${b.pct}% for ${rv.name} (${cycle}, ${band}).`);
  return ok({ id });
}

async function incDecide(c: C, b: any): Promise<Result> {
  const p = (await get(c.cid, 'p2Inc', str(b.id, 200))) as IncDoc | null;
  if (!p) return notFound('That increment');
  if (p.uid === c.ctx.uid) return denied('You cannot approve your own increment.');
  const cal = (await get(c.cid, 'p2Cal', calId(c.cid, p.cycleKey))) as CalDoc | null;
  const approval = cal?.snapshot.config.approval || DEFAULT_PM2.approval;
  const note = str(b.note, 300);
  if (b.decision === 'reject') {
    if (!c.isHr && !c.isApprover) return denied();
    if (!['RECOMMENDED', 'HR_APPROVED'].includes(p.status)) return conflict('Nothing is waiting for approval.');
    if (note.length < 5) return bad('Say why it is being rejected.');
    await put('p2Inc', { ...p, status: 'REJECTED', history: [...p.history, { at: nowIso(), by: c.who, byUid: c.ctx.uid, action: 'REJECTED', note }] });
    await audit(c, p.id, 'P2_INC_REJECTED', `${p.name}: ${note}`, p.uid);
    await tell(c, [p.recommendedByUid], `Increment sent back: ${p.name}`, `${c.who} rejected the recommended ${p.pct}% for ${p.name}. Reason: ${note}`);
    return ok({ status: 'REJECTED' });
  }
  const step = nextIncStatus(p.status, approval, c.isHr, c.isApprover);
  if (!step.next) return p.status === 'HR_APPROVED' || p.status === 'RECOMMENDED' ? denied(step.error) : conflict(step.error!);
  // Four eyes: the second approval must come from someone other than the first.
  if (p.status === 'HR_APPROVED' && p.history.some((h) => h.action === 'HR_APPROVED' && h.byUid === c.ctx.uid)) return denied('A different person must give the second approval.');
  if (p.recommendedByUid === c.ctx.uid && p.status === 'RECOMMENDED') return denied('Someone other than the person who recommended it must approve it.');
  await put('p2Inc', { ...p, status: step.next, history: [...p.history, { at: nowIso(), by: c.who, byUid: c.ctx.uid, action: step.next === 'HR_APPROVED' ? 'HR_APPROVED' : 'APPROVED', note }] });
  await audit(c, p.id, step.next === 'APPROVED' ? 'P2_INC_APPROVED' : 'P2_INC_HR_APPROVED', `${p.name}: ${p.pct}%. ${note}`, p.uid);
  return ok({ status: step.next });
}

/** Hands an approved increment to Payroll as a SCHEDULED salary revision. Payroll applies it later through its own screen. */
async function incSend(c: C, b: any): Promise<Result> {
  const canPayroll = c.ctx.isCompanyAdmin || c.ctx.perms.includes('payroll.manage');
  if (!canPayroll) return denied('Sending a salary change to Payroll needs payroll permission.');
  const p = (await get(c.cid, 'p2Inc', str(b.id, 200))) as IncDoc | null;
  if (!p) return notFound('That increment');
  if (p.status === 'SENT') return ok({ already: true, revisionId: p.revisionId });
  if (p.status !== 'APPROVED') return conflict('Only a fully approved increment can be sent to Payroll.');
  const effectiveFrom = str(b.effectiveFrom, 10) || nextFirstOfMonth(istToday());
  if (!isDate(effectiveFrom) || effectiveFrom.slice(8, 10) !== '01') return bad('A salary change must start on the first day of a month.');
  const { settings, configured } = await loadPayrollSettings(c.cid);
  if (!configured) return conflict('Payroll components are not set up yet.');
  const st = (await loadStructures(c.cid)).get(p.uid);
  if (!st) return conflict(`${p.name} has no salary in Payroll yet. Set the salary first; an increment changes an existing salary.`);
  const amounts = scaleAmounts(st.amounts, p.pct);
  const annualCtc = Math.round(grossOf({ amounts }, settings) * 12 * 100) / 100;
  const ref = db().collection('payrollRevisions').doc();
  await ref.set({
    companyId: c.cid, uid: p.uid, effectiveFrom, amounts, annualCtc, note: `Performance ${p.cycleKey}: ${p.pct}% (${p.band})`, status: 'SCHEDULED',
    createdBy: `${c.who} (Performance 2)`, createdAt: nowIso(),
  });
  await put('p2Inc', { ...p, status: 'SENT', effectiveFrom, revisionId: ref.id, history: [...p.history, { at: nowIso(), by: c.who, byUid: c.ctx.uid, action: 'SENT_TO_PAYROLL', note: `Effective ${effectiveFrom}` }] });
  await audit(c, p.id, 'P2_INC_SENT', `${p.name}: ${p.pct}% from ${effectiveFrom} sent to Payroll as a scheduled revision. Payroll applies it.`, p.uid);
  return ok({ revisionId: ref.id, effectiveFrom, message: 'Sent to Payroll as a scheduled revision. It changes nothing until Payroll applies it.' });
}

// ------------------------------------------------------------------ goals as evidence

async function goalsGet(c: C, _b: any, q: any): Promise<Result> {
  const { config } = await configOf(c.cid);
  if (!config.goals.enabled) return conflict('Goals as evidence is turned off.');
  const cycle = cycleOfQuery(q);
  const uid = str(q.uid, 128) || c.ctx.uid;
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  if (!canSee(c, uid)) return denied();
  const snap = await db().collection('hrbpItems').where('companyId', '==', c.cid).where('kind', '==', 'okr').get();
  const mine = snap.docs.map((d: any) => d.data()).filter((o: any) => o.level === 'INDIVIDUAL' && o.quarter === cycle && o.ownerUid === uid);
  const objectives = mine.map((o: any) => ({ id: o.id, title: o.title, state: o.state, progress: Math.round(objectiveProgress(o.keyResults || []) * 100) }));
  const average = objectives.length ? Math.round(objectives.reduce((a: number, o: any) => a + o.progress, 0) / objectives.length) : null;
  const check = await get(c.cid, 'p2Goal', subId(c.cid, cycle, uid));
  return ok({
    cycle, uid, objectives, averageProgress: average, suggested: suggestRating(average),
    note: 'This is a suggestion from goal progress. It is not a rating until a reviewer confirms it.',
    confirmed: check ? { rating: check.rating, note: check.note, by: check.by, at: check.at, suggestedThen: check.suggested } : null,
  });
}

async function goalsConfirm(c: C, b: any): Promise<Result> {
  const { config } = await configOf(c.cid);
  if (!config.goals.enabled) return conflict('Goals as evidence is turned off.');
  const cycle = cycleOfQuery({}, b);
  const uid = str(b.uid, 128);
  if (!isCycle(cycle) || !uid) return bad('Choose a person and a quarter.');
  if (uid === c.ctx.uid) return denied('You cannot confirm a rating for yourself.');
  if (!c.isHr && !isManagerOf(c, uid)) return denied('Only the manager or HR can confirm this.');
  const r = b.rating === 'NO' ? 'NO' : Number(b.rating);
  if (r !== 'NO' && !(Number.isInteger(r) && r >= 1 && r <= 5)) return bad('Choose a rating from 1 to 5, or "Not observed".');
  const g = await goalsGet(c, {}, { cycle, uid });
  if (g.status !== 200) return g;
  const note = str(b.note, 300);
  if (r !== g.json.suggested && note.length < 5) return bad('The rating differs from the suggestion. Say why.');
  await put('p2Goal', { id: subId(c.cid, cycle, uid), companyId: c.cid, cycleKey: cycle, uid, rating: r, suggested: g.json.suggested, averageProgress: g.json.averageProgress, note, by: c.who, at: nowIso() });
  await audit(c, subId(c.cid, cycle, uid), 'P2_GOAL_CONFIRMED', `Suggested ${g.json.suggested ?? 'none'}, confirmed ${r}${note ? `: ${note}` : ''}`, uid);
  return ok({ rating: r });
}

// ------------------------------------------------------------------ 360 feedback

const panelOf = (c: C, cycle: string, uid: string) => get(c.cid, 'p2Panel', subId(c.cid, cycle, uid));

async function threeSixtyOn(c: C): Promise<{ config: Pm2Config } | { off: Result }> {
  const { config } = await configOf(c.cid);
  return config.threeSixty.enabled ? { config } : { off: conflict('360 feedback is turned off for this company.') };
}

async function nominate(c: C, b: any): Promise<Result> {
  const on = await threeSixtyOn(c); if ('off' in on) return on.off;
  const cycle = cycleOfQuery({}, b);
  const subject = str(b.uid, 128) || c.ctx.uid;
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  if (subject !== c.ctx.uid && !isManagerOf(c, subject) && !c.isHr) return denied('You can choose reviewers for yourself, your team, or (as HR) anyone.');
  const person = c.byUid.get(subject);
  if (!person || !person.active) return notFound('That employee');
  const raters = Array.isArray(b.raters) ? [...new Set<string>(b.raters.map((x: any) => str(x, 128)).filter(Boolean))] : [];
  const problem = panelProblem(subject, raters, on.config.threeSixty);
  if (problem) return bad(problem);
  if (raters.some((u) => !c.byUid.get(u)?.active)) return bad('One of the people chosen is not an active employee.');
  const id = subId(c.cid, cycle, subject);
  const prior = await get(c.cid, 'p2Panel', id);
  if (prior && prior.status === 'APPROVED') return conflict('The reviewers are already approved. Ask HR if something must change.');
  const auto = c.isHr && subject !== c.ctx.uid;
  await put('p2Panel', { id, companyId: c.cid, cycleKey: cycle, subjectUid: subject, subjectName: person.name, raters: raters.map((u) => ({ uid: u })), status: auto ? 'APPROVED' : 'PROPOSED', proposedBy: c.who, proposedByUid: c.ctx.uid, released: false, ...(auto ? { approvedBy: c.who } : {}) });
  await audit(c, id, 'P2_360_NOMINATED', `${person.name}: ${raters.length} reviewers chosen${auto ? ' and approved' : ''}.`, subject);
  if (auto) await tell(c, raters, 'Your feedback is requested', `You have been asked to give confidential feedback about ${person.name} (${cycle}). It takes a few minutes and your name is never shown to them.`);
  else await tell(c, await hrUids(c), `360 reviewers to approve: ${person.name}`, `${c.who} chose ${raters.length} reviewers for ${person.name} (${cycle}).`);
  return ok({ id, status: auto ? 'APPROVED' : 'PROPOSED' });
}

async function approvePanel(c: C, b: any): Promise<Result> {
  const p = await get(c.cid, 'p2Panel', str(b.id, 200));
  if (!p) return notFound('That panel');
  if (p.subjectUid === c.ctx.uid) return denied('You cannot approve the reviewers chosen for yourself.');
  if (p.status === 'APPROVED') return ok({ already: true });
  await put('p2Panel', { ...p, status: 'APPROVED', approvedBy: c.who });
  await audit(c, p.id, 'P2_360_APPROVED', `${p.subjectName}: reviewers approved.`, p.subjectUid);
  await tell(c, p.raters.map((r: any) => r.uid), 'Your feedback is requested', `You have been asked to give confidential feedback about ${p.subjectName} (${p.cycleKey}). It takes a few minutes and your name is never shown to them.`);
  return ok({ status: 'APPROVED' });
}

async function releasePanel(c: C, b: any): Promise<Result> {
  const p = await get(c.cid, 'p2Panel', str(b.id, 200));
  if (!p) return notFound('That panel');
  if (p.status !== 'APPROVED') return conflict('Approve the reviewers first.');
  await put('p2Panel', { ...p, released: true });
  await audit(c, p.id, 'P2_360_RELEASED', `${p.subjectName}: the summary is now visible to them.`, p.subjectUid);
  return ok({ released: true });
}

async function panels(c: C, _b: any, q: any): Promise<Result> {
  const cycle = cycleOfQuery(q);
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  const all = await list(c.cid, 'p2Panel', { cycleKey: cycle });
  const fb = await list(c.cid, 'p2Fb', {});
  const rows = all.filter((p) => c.isHr || p.subjectUid === c.ctx.uid || isManagerOf(c, p.subjectUid) || p.proposedByUid === c.ctx.uid).map((p) => {
    const sees = c.isHr || p.proposedByUid === c.ctx.uid;
    return {
      id: p.id, uid: p.subjectUid, name: p.subjectName, status: p.status, released: !!p.released, requested: p.raters.length, responded: fb.filter((f) => f.panelId === p.id).length,
      // Names are shown only to HR and to whoever chose them. Nobody sees who has answered.
      nominated: sees ? p.raters.map((r: any) => c.byUid.get(r.uid)?.name || '') : undefined, proposedBy: p.proposedBy,
    };
  });
  const missing = c.isHr ? active(c).filter((x) => !all.some((p) => p.subjectUid === x.uid)).map((x) => ({ uid: x.uid, name: x.name })) : [];
  return ok({ cycle, rows, withoutPanel: missing });
}

async function toGive(c: C): Promise<Result> {
  const all = (await list(c.cid, 'p2Panel')).filter((p) => p.status === 'APPROVED' && p.raters.some((r: any) => r.uid === c.ctx.uid));
  const done = new Set((await list(c.cid, 'p2Fb')).filter((f) => f.raterUid === c.ctx.uid).map((f) => f.panelId));
  const s = await settingsOf(c.cid);
  return ok({
    items: all.filter((p) => !done.has(p.id)).map((p) => ({ id: p.id, subjectName: p.subjectName, cycleKey: p.cycleKey })),
    competencies: s.competencies.map((x) => ({ id: x.id, name: x.name, standard: x.standard })),
  });
}

async function give(c: C, b: any): Promise<Result> {
  const on = await threeSixtyOn(c); if ('off' in on) return on.off;
  const p = await get(c.cid, 'p2Panel', str(b.id, 200));
  if (!p || !p.raters.some((r: any) => r.uid === c.ctx.uid)) return notFound('That feedback request');
  if (p.status !== 'APPROVED') return conflict('This request is not open yet.');
  const fid = `${p.id}_${c.ctx.uid}`;
  if (await get(c.cid, 'p2Fb', fid)) return conflict('You have already sent your feedback. It cannot be changed.');
  const s = await settingsOf(c.cid);
  const ids = new Set(s.competencies.map((x) => x.id));
  const ratings: Record<string, number | 'NO'> = {};
  for (const [k, v] of Object.entries(b.ratings && typeof b.ratings === 'object' ? b.ratings : {})) {
    if (!ids.has(k)) continue;
    if (v === 'NO') { ratings[k] = 'NO'; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) return bad('Ratings are from 1 to 5, or "Not observed".');
    ratings[k] = n;
  }
  if (!Object.values(ratings).some((v) => typeof v === 'number')) return bad('Rate at least one behaviour.');
  await put('p2Fb', { id: fid, companyId: c.cid, panelId: p.id, cycleKey: p.cycleKey, subjectUid: p.subjectUid, raterUid: c.ctx.uid, ratings, comment: str(b.comment, 1000) });
  // Deliberately no audit line: the audit trail must not show who answered.
  return ok({ message: 'Thank you. Your feedback was sent without your name.' });
}

async function result(c: C, _b: any, q: any): Promise<Result> {
  const on = await threeSixtyOn(c); if ('off' in on) return on.off;
  const cycle = cycleOfQuery(q);
  const uid = str(q.uid, 128) || c.ctx.uid;
  if (!isCycle(cycle)) return bad('Choose a quarter like 2026-Q4.');
  if (!canSee(c, uid)) return denied();
  const p = await panelOf(c, cycle, uid);
  if (!p || p.status !== 'APPROVED') return ok({ cycle, uid, available: false, message: 'No 360 feedback has been set up for this quarter.' });
  const self = uid === c.ctx.uid;
  if (self && !p.released) return ok({ cycle, uid, available: false, message: 'Your 360 summary will appear here when HR releases it.' });
  const s = await settingsOf(c.cid);
  const responses = (await list(c.cid, 'p2Fb', { panelId: p.id })).map((f) => ({ ratings: f.ratings, comment: f.comment || '' }));
  const agg = aggregate360(responses, p.raters.length, on.config.threeSixty.minRaters, s.competencies.map((x) => x.id), p.id);
  const names = new Map(s.competencies.map((x) => [x.id, x.name]));
  let blend: any = null;
  if (!self) {
    const rv = await get(c.cid, 'reviews', subId(c.cid, cycle, uid));
    const mgr = rv?.score && typeof rv.score.behaviour === 'number' ? rv.score.behaviour : null;
    blend = { managerBehaviour: mgr, peerAverage: agg.average, suggested: blendBehaviour(mgr, agg.average, on.config.threeSixty.peerSharePct), peerSharePct: on.config.threeSixty.peerSharePct, note: 'A suggestion for the behaviour score. The manager\'s own rating stays the record.' };
  }
  return ok({
    cycle, uid, available: true, name: p.subjectName, minRaters: on.config.threeSixty.minRaters, ...agg,
    byCompetency: agg.byCompetency.map((x) => ({ ...x, name: names.get(x.id) || x.id })),
    waiting: agg.enough ? '' : `${agg.responded} of ${agg.requested} have answered. Results appear once ${on.config.threeSixty.minRaters} have, so no one can be identified.`, blend,
  });
}

/** HR only, for abuse or a complaint. Needs a written reason and leaves a line in the audit trail. */
async function auditPanel(c: C, b: any): Promise<Result> {
  const p = await get(c.cid, 'p2Panel', str(b.id, 200));
  if (!p) return notFound('That panel');
  if (p.subjectUid === c.ctx.uid) return denied('You cannot look into feedback about yourself.');
  const reason = str(b.reason, 400);
  if (reason.length < 15) return bad('Write why you need to see who said what (at least a sentence). It is logged.');
  const fb = await list(c.cid, 'p2Fb', { panelId: p.id });
  await audit(c, p.id, 'P2_360_IDENTITIES_VIEWED', `${p.subjectName}: ${reason}`, p.subjectUid);
  return ok({
    name: p.subjectName,
    raters: p.raters.map((r: any) => {
      const f = fb.find((x) => x.raterUid === r.uid);
      return { name: c.byUid.get(r.uid)?.name || r.uid, responded: !!f, comment: f?.comment || '' };
    }),
  });
}

// ------------------------------------------------------------------ routes

export const PM2_ROUTES: Record<string, Route> = {
  'p2-home': { method: 'GET', who: 'any', run: (c) => home(c) },
  'p2-config': { method: 'GET', who: 'approver', run: (c) => configGet(c) },
  'p2-config-save': { method: 'POST', who: 'hr', run: (c, b) => configSave(c, b) },
  'p2-cal': { method: 'GET', who: 'approver', run: (c, b, q) => calGet(c, b, q) },
  'p2-cal-open': { method: 'POST', who: 'hr', run: (c, b) => calOpen(c, b) },
  'p2-cal-adjust': { method: 'POST', who: 'approver', run: (c, b) => calAdjust(c, b) },
  'p2-cal-finalise': { method: 'POST', who: 'approver', run: (c, b) => calFinalise(c, b) },
  'p2-cal-amend': { method: 'POST', who: 'hr', run: (c, b) => calAmend(c, b) },
  'p2-inc': { method: 'GET', who: 'any', run: (c, b, q) => incList(c, b, q) },
  'p2-inc-recommend': { method: 'POST', who: 'any', run: (c, b) => incRecommend(c, b) },
  'p2-inc-decide': { method: 'POST', who: 'approver', run: (c, b) => incDecide(c, b) },
  'p2-inc-send': { method: 'POST', who: 'hr', run: (c, b) => incSend(c, b) },
  'p2-goals': { method: 'GET', who: 'any', run: (c, b, q) => goalsGet(c, b, q) },
  'p2-goals-confirm': { method: 'POST', who: 'any', run: (c, b) => goalsConfirm(c, b) },
  'p2-360-nominate': { method: 'POST', who: 'any', run: (c, b) => nominate(c, b) },
  'p2-360-approve': { method: 'POST', who: 'hr', run: (c, b) => approvePanel(c, b) },
  'p2-360-release': { method: 'POST', who: 'hr', run: (c, b) => releasePanel(c, b) },
  'p2-360-panels': { method: 'GET', who: 'any', run: (c, b, q) => panels(c, b, q) },
  'p2-360-todo': { method: 'GET', who: 'any', run: (c) => toGive(c) },
  'p2-360-give': { method: 'POST', who: 'any', run: (c, b) => give(c, b) },
  'p2-360-result': { method: 'GET', who: 'any', run: (c, b, q) => result(c, b, q) },
  'p2-360-audit': { method: 'POST', who: 'hr', run: (c, b) => auditPanel(c, b) },
};
