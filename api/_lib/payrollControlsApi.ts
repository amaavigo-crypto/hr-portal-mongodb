/**
 * Payroll controls, reached as /api/leave/payroll-<action> through the payroll router:
 *
 *   controls, save-controls                  approval chain, separation of duties, calendar, company details, cost centres (admin only to save)
 *   approval-state, approval-step            HR > Finance > signatory, tied to a fingerprint of the calculated run
 *   calendar, period-freeze, period-unfreeze cut-off dates and the input freeze (a reason is needed to unfreeze)
 *   payment, payment-create, payment-submit, payment-import, payment-mark, payment-retry, payment-export, payment-close
 *   salary-versions                          a person's salary as it stood on each effective date
 *   cost-centres, save-cost-centres, cost-allocations, cost-allocation, save-cost-allocation, cost-report
 *
 *   payrollControls/{companyId}              settings, cost centres and the freeze log
 *   payrollPayments/{companyId__month}       one bank payment batch with a line per person
 *   payrollSalaryVersions/{id}               one effective-dated salary version
 *   payrollCostAllocations/{companyId__uid}  how one person's cost is shared between cost centres
 */
import { createHash } from 'node:crypto';
import { db, loadPeople, nowIso, personByUid, str } from './leaveCore.js';
import { istToday } from '../../shared/leaveEngine.js';
import { maskAccount, r2 } from '../../shared/payrollEngine.js';
import {
  PayrollError, actorName, clean, fail, loadLines, loadPayrollSettings, loadStructures, needManage, needMonth, needView, ok, runId, runOf,
  type LineDoc, type Result, type RunDoc, type Who,
} from './payrollKit.js';
import {
  STEPS, STEP_LABEL, allocationProblem, applyBankRows, buildInstructions, checkControls, defaultControls, dutyProblem, nextStep, paymentSummary,
  parseBankResponse, parseStatus, periodDates, periodOf, readControls, slugId, splitByAllocation, stageOf, stepProblem, versionAsOf,
  type AllocRow, type Controls, type Instruction, type SalaryVersion, type Step,
} from '../../shared/payrollControls.js';

// ------------------------------------------------------------------ loading and guards

export async function loadControls(cid: string): Promise<Controls> {
  const snap = await db().collection('payrollControls').doc(cid).get();
  return snap.exists ? readControls(snap.data()) : defaultControls();
}
const saveControlsDoc = async (cid: string, c: Controls, by: string) =>
  db().collection('payrollControls').doc(cid).set(clean({ ...c, companyId: cid, updatedAt: nowIso(), updatedBy: by }));

/** Key order does not matter: the same figures always give the same fingerprint. */
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export function runHash(month: string, lines: LineDoc[]): string {
  const body = [...lines].sort((a, b) => a.uid.localeCompare(b.uid)).map((l) => ({ uid: l.uid, inputs: l.inputs, line: l.line }));
  return createHash('sha256').update(JSON.stringify(canon({ month, body }))).digest('hex');
}

const prevMonthStart = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};
/** People who changed a salary structure in this payroll month or the month before. */
async function salaryEditors(cid: string, month: string): Promise<string[]> {
  const st = await loadStructures(cid);
  const since = prevMonthStart(month);
  return [...new Set([...st.values()].filter((s: any) => s.updatedByUid && String(s.updatedAt).slice(0, 10) >= since).map((s: any) => String(s.updatedByUid)))];
}

export const approverUids = (run: RunDoc): string[] => STEPS.map((s) => run.approvals?.[s]?.uid).filter(Boolean) as string[];

/** Called before a person changes an input of a month. A frozen month refuses until it is unfrozen with a reason. */
export async function guardFrozen(cid: string, month: string) {
  const c = await loadControls(cid);
  if (c.calendar.enabled && periodOf(c, month).status === 'FROZEN') {
    throw new PayrollError(409, `The ${month} inputs are frozen. Unfreeze the month (with a reason) in Payroll calendar before changing them.`);
  }
}

/** Used by the single-step approve (chain off). Returns a sentence when the person must not approve. */
export async function approveProblem(who: Who, run: RunDoc, month: string): Promise<string> {
  const c = await loadControls(who.cid);
  if (c.chain.enabled) return 'This company approves payroll in three steps (HR, Finance, final authorisation). Use the approval steps.';
  if (c.calendar.enabled && c.calendar.requireFreeze && periodOf(c, month).status !== 'FROZEN') return `Freeze the ${month} inputs in Payroll calendar before approving.`;
  return dutyProblem(c, who.ctx.uid, 'APPROVE', run.touchedBy || [], [], await salaryEditors(who.cid, month));
}

/** Used when someone marks a run paid or releases a bank batch. */
export async function releaseProblem(who: Who, run: RunDoc, month: string): Promise<string> {
  const c = await loadControls(who.cid);
  const approvers = [...approverUids(run), ...(run.approvedByUid ? [run.approvedByUid] : [])];
  return dutyProblem(c, who.ctx.uid, 'RELEASE', run.touchedBy || [], approvers, await salaryEditors(who.cid, month));
}

export async function paymentBlocksPaid(cid: string, month: string): Promise<boolean> {
  const snap = await db().collection('payrollPayments').doc(runId(cid, month)).get();
  return snap.exists && snap.get('status') !== 'CLOSED';
}

// ------------------------------------------------------------------ settings

async function controlsGet(who: Who): Promise<Result> {
  needView(who);
  const [c, people] = await Promise.all([loadControls(who.cid), loadPeople(who.cid)]);
  const { periods, ...rest } = c;
  void periods;
  return ok({ controls: rest, canChange: who.ctx.isCompanyAdmin, people: people.filter((p) => p.active).map((p) => ({ uid: p.uid, name: p.name, empId: p.empId, email: p.email })) });
}

async function controlsSave(who: Who, body: any): Promise<Result> {
  if (!who.ctx.isCompanyAdmin) throw new PayrollError(403, 'Only a company admin can change payroll controls.');
  const prev = await loadControls(who.cid);
  const people = await loadPeople(who.cid);
  const res = checkControls(body?.controls ?? body, prev);
  if (res.error) return fail(400, res.error);
  const c = res.controls!;
  const active = new Set(people.filter((p) => p.active).map((p) => p.uid));
  for (const uid of [...c.chain.hr, ...c.chain.finance, ...c.chain.signatory]) if (!active.has(uid)) return fail(400, 'One of the chosen approvers is not an active employee.');
  await saveControlsDoc(who.cid, c, await actorName(who));
  return ok({});
}

// ------------------------------------------------------------------ approval chain

async function approvalState(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const [c, run] = await Promise.all([loadControls(who.cid), runOf(who.cid, month)]);
  if (!c.chain.enabled) return ok({ enabled: false });
  if (!run) return ok({ enabled: true, run: null, steps: [] });
  const editors = await salaryEditors(who.cid, month);
  const step = run.status === 'DRAFT' ? nextStep(run.approvals) : null;
  const steps = STEPS.map((s) => ({
    step: s, label: STEP_LABEL[s], done: run.approvals?.[s] ? { by: run.approvals[s]!.name, at: run.approvals[s]!.at, note: run.approvals[s]!.note || '' } : null,
    problem: step === s ? stepProblem({ controls: c, uid: who.ctx.uid, step: s, approvals: run.approvals, touchedBy: run.touchedBy || [], salaryEditors: editors }) : '',
  }));
  return ok({ enabled: true, status: run.status, hash: run.contentHash || '', next: step, steps });
}

export interface Deps { calculateRun: (who: Who, month: string) => Promise<{ run: RunDoc; lines: LineDoc[] }> }

async function approvalStep(who: Who, body: any, deps: Deps): Promise<Result> {
  needView(who);
  const month = needMonth(body?.month);
  const step = String(body?.step) as Step;
  if (!STEPS.includes(step)) return fail(400, 'Unknown approval step.');
  const c = await loadControls(who.cid);
  if (!c.chain.enabled) return fail(409, 'The approval chain is not turned on. Use the normal approve button.');
  let run = await runOf(who.cid, month);
  if (!run) throw new PayrollError(409, 'Calculate the run first.');
  if (run.status !== 'DRAFT') throw new PayrollError(409, `This run is already ${run.status.toLowerCase()}.`);
  const editors = await salaryEditors(who.cid, month);
  const why = stepProblem({ controls: c, uid: who.ctx.uid, step, approvals: run.approvals, touchedBy: run.touchedBy || [], salaryEditors: editors });
  if (why) throw new PayrollError(403, why);
  if (typeof body?.expectedHash !== 'string' || !body.expectedHash) throw new PayrollError(400, 'Send the run fingerprint you reviewed.');

  let lines: LineDoc[];
  if (step === 'HR') {
    if (c.calendar.enabled && c.calendar.requireFreeze && periodOf(c, month).status !== 'FROZEN') throw new PayrollError(409, `Freeze the ${month} inputs in Payroll calendar first.`);
    // HR checks the freshest figures: recalculate so that what is approved is exactly what is stored now.
    const fresh = await deps.calculateRun(who, month);
    lines = fresh.lines;
    run = fresh.run;
    if (lines.length === 0) throw new PayrollError(409, 'There is nobody in this run.');
    const blocked = lines.filter((l) => l.line.blocking);
    if (blocked.length) throw new PayrollError(409, `Fix these first: ${blocked.slice(0, 5).map((l) => l.employee.name).join(', ')}${blocked.length > 5 ? ` and ${blocked.length - 5} more` : ''}.`);
    const { monthRange } = await import('./leaveApi.js');
    if (body?.force !== true && istToday() <= monthRange(month).to) throw new PayrollError(409, `${month} has not ended yet. Approve anyway only if you are sure the remaining days are paid.`);
  } else {
    lines = await loadLines(who.cid, month);
  }
  const hash = runHash(month, lines);
  if (hash !== body.expectedHash) throw new PayrollError(409, 'The figures changed since you last looked. Open the run again and review it.');
  if (run.contentHash && run.contentHash !== hash) throw new PayrollError(409, 'The stored run does not match its fingerprint. Recalculate it.');
  const stale = STEPS.filter((s) => run!.approvals?.[s] && run!.approvals[s]!.hash !== hash);
  if (stale.length) throw new PayrollError(409, 'An earlier approval no longer matches this run. Approvals must be repeated.');

  const by = await actorName(who);
  const now = nowIso();
  const approvals = { ...(run.approvals || {}), [step]: { uid: who.ctx.uid, name: by, at: now, hash, note: str(body?.note, 300) } };
  const events = [...run.events, { at: now, by, action: `APPROVED_${step}`, note: str(body?.note, 300) }].slice(-100);
  const done = nextStep(approvals) === null;
  const next: RunDoc = {
    ...run, approvals, contentHash: hash, events,
    ...(done ? { status: 'APPROVED' as const, approvedAt: now, approvedBy: by, approvedByUid: who.ctx.uid } : {}),
  };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean(next));
  return ok({ run: next, next: nextStep(approvals), complete: done });
}

/** Drop the approvals when what they approved has changed. Returns true when there were any. */
export async function clearApprovals(who: Who, month: string, reason: string): Promise<boolean> {
  const run = await runOf(who.cid, month);
  if (!run || !run.approvals || !Object.keys(run.approvals).length) return false;
  const next: RunDoc = { ...run, approvals: undefined, events: [...run.events, { at: nowIso(), by: await actorName(who), action: 'APPROVALS_CLEARED', note: reason }].slice(-100) };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean(next));
  return true;
}

/** A person changed an input of a draft run: they become one of its makers, and earlier approvals no longer stand. */
export async function noteChange(who: Who, month: string, reason: string) {
  const run = await runOf(who.cid, month);
  if (!run || run.status !== 'DRAFT') return;
  const had = !!run.approvals && Object.keys(run.approvals).length > 0;
  const next: RunDoc = {
    ...run, touchedBy: [...new Set([...(run.touchedBy || []), who.ctx.uid])],
    ...(had ? { approvals: undefined, events: [...run.events, { at: nowIso(), by: await actorName(who), action: 'APPROVALS_CLEARED', note: reason }].slice(-100) } : {}),
  };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean(next));
}

// ------------------------------------------------------------------ calendar and freeze

async function calendar(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const [c, run, pay] = await Promise.all([loadControls(who.cid), runOf(who.cid, month), db().collection('payrollPayments').doc(runId(who.cid, month)).get()]);
  const p = periodOf(c, month);
  const dates = periodDates(month, c.calendar);
  const today = istToday();
  const stage = stageOf(run?.status ?? null, run?.approvals, p.status === 'FROZEN', pay.exists);
  const daysToCutoff = Math.round((Date.parse(dates.cutoff) - Date.parse(today)) / 86400000);
  return ok({
    month, enabled: c.calendar.enabled, settings: c.calendar, ...dates, status: p.status, frozenAt: p.at || '', frozenBy: p.by || '', log: p.log.slice(-20), stage,
    runStatus: run?.status || 'NOT_RUN', daysToCutoff,
    warning: c.calendar.enabled && p.status !== 'FROZEN' && daysToCutoff < 0 && !['LOCKED', 'PAID'].includes(run?.status || '') ? `The cut-off (${dates.cutoff}) has passed and the inputs are not frozen.` : '',
  });
}

async function setPeriod(who: Who, body: any, freeze: boolean): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const c = await loadControls(who.cid);
  if (!c.calendar.enabled) return fail(409, 'Turn the payroll calendar on in Payroll controls first.');
  const run = await runOf(who.cid, month);
  if (run && run.status !== 'DRAFT') throw new PayrollError(409, `The ${month} payroll is ${run.status.toLowerCase()}, so its inputs cannot be unfrozen or frozen.`);
  const p = periodOf(c, month);
  const reason = str(body?.reason, 300);
  if (!freeze && !reason) return fail(400, 'Write the reason for unfreezing, so it is on record.');
  if (freeze && p.status === 'FROZEN') return ok({ already: true });
  if (!freeze && p.status !== 'FROZEN') return ok({ already: true });
  const by = await actorName(who);
  const now = nowIso();
  c.periods[month] = { status: freeze ? 'FROZEN' : 'OPEN', at: now, by, log: [...p.log, { at: now, by, action: freeze ? 'FROZEN' : 'UNFROZEN', note: reason }].slice(-50) };
  await saveControlsDoc(who.cid, c, by);
  // Unfreezing changes inputs, so earlier approvals no longer stand.
  if (!freeze) await clearApprovals(who, month, 'Inputs unfrozen: ' + reason);
  return ok({ status: c.periods[month].status });
}

// ------------------------------------------------------------------ bank payments

const payRef = (cid: string, month: string) => db().collection('payrollPayments').doc(runId(cid, month));
const loadPayment = async (cid: string, month: string) => { const s = await payRef(cid, month).get(); return s.exists ? (s.data() as any) : null; };
const view = (p: any) => (p ? { ...p, summary: paymentSummary(p.instructions || []) } : null);

async function paymentGet(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  return ok({ month, payment: view(await loadPayment(who.cid, month)) });
}

async function paymentCreate(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run || run.status !== 'LOCKED') throw new PayrollError(409, 'Lock the payroll run before preparing the bank payment.');
  const existing = await loadPayment(who.cid, month);
  if (existing) return ok({ payment: view(existing), existed: true });
  const [lines, c, by] = await Promise.all([loadLines(who.cid, month), loadControls(who.cid), actorName(who)]);
  const now = nowIso();
  const instructions = buildInstructions(lines.map((l) => ({
    uid: l.uid, empId: l.employee.empId, name: l.employee.name, net: l.line.net, bankName: l.employee.bankName || '', account: l.bank.account || '', ifsc: l.employee.ifsc || '',
  })), maskAccount, now);
  const doc = {
    companyId: who.cid, month, status: 'READY', createdAt: now, createdBy: by, createdByUid: who.ctx.uid,
    debit: { bankName: c.entity.bankName, accountMasked: maskAccount(c.entity.bankAccount), ifsc: c.entity.bankIfsc },
    instructions, events: [{ at: now, by, action: 'CREATED', note: `${instructions.length} payments` }],
  };
  await payRef(who.cid, month).set(clean(doc));
  return ok({ payment: view(doc) });
}

const save = async (who: Who, month: string, p: any, action: string, note: string, patch: Record<string, any> = {}) => {
  const by = await actorName(who);
  const sum = paymentSummary(p.instructions);
  const status = p.status === 'CLOSED' ? 'CLOSED' : sum.by.SUBMITTED.count > 0 ? 'PROCESSING' : sum.allPaid ? 'RECONCILED' : p.status === 'READY' ? 'READY' : 'PROCESSING';
  const next = { ...p, ...patch, status: patch.status || status, events: [...p.events, { at: nowIso(), by, action, note }].slice(-200) };
  await payRef(who.cid, month).set(clean(next));
  return next;
};

async function needPayment(who: Who, month: string) {
  const p = await loadPayment(who.cid, month);
  if (!p) throw new PayrollError(409, 'Prepare the bank payment first.');
  if (p.status === 'CLOSED') throw new PayrollError(409, 'This payment batch is closed.');
  return p;
}

async function paymentSubmit(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const p = await needPayment(who, month);
  const run = (await runOf(who.cid, month))!;
  const why = await releaseProblem(who, run, month);
  if (why) throw new PayrollError(403, why);
  const ready = p.instructions.filter((i: Instruction) => i.status === 'READY');
  if (!ready.length) throw new PayrollError(409, 'Nothing is ready to submit. Fix blocked payments or retry failed ones first.');
  const now = nowIso();
  const instructions = p.instructions.map((i: Instruction) => (i.status === 'READY' ? { ...i, status: 'SUBMITTED', tries: i.tries + 1, updatedAt: now } : i));
  const total = r2(ready.reduce((n: number, i: Instruction) => n + i.amount, 0));
  const next = await save(who, month, { ...p, instructions }, 'SUBMITTED', `${ready.length} payments, ${total}`, { submittedAt: now, submittedBy: await actorName(who), submittedByUid: who.ctx.uid, batchRef: str(body?.ref, 80) || p.batchRef || '' });
  return ok({ payment: view(next) });
}

async function paymentImport(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const p = await needPayment(who, month);
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return fail(400, 'Paste or upload the bank response first.');
  if (csv.length > 2_000_000) return fail(400, 'The file is too large.');
  const parsed = parseBankResponse(csv);
  if (!parsed.rows.length) return fail(400, parsed.problems[0] || 'No rows were found.');
  const r = applyBankRows(p.instructions, parsed.rows, nowIso());
  const next = await save(who, month, { ...p, instructions: r.instructions }, 'BANK_RESPONSE', `${r.updated} updated`);
  return ok({ payment: view(next), updated: r.updated, unknownEmployees: r.unknown, skipped: r.skipped, problems: parsed.problems });
}

async function paymentMark(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const p = await needPayment(who, month);
  const status = parseStatus(body?.status);
  if (!status) return fail(400, 'Choose paid, failed or returned.');
  const uid = str(body?.uid, 128);
  const target = p.instructions.find((i: Instruction) => i.uid === uid);
  if (!target) return fail(404, 'That person is not in this batch.');
  const ref = str(body?.ref, 60);
  const reason = str(body?.reason, 200);
  if (status === 'PAID' && !ref) return fail(400, 'Enter the bank reference (UTR) or a note saying how it was paid.');
  if (status !== 'PAID' && !reason) return fail(400, 'Write the reason, so it is on record.');
  const instructions = p.instructions.map((i: Instruction) => (i.uid === uid ? { ...i, status, ref: ref || i.ref, reason: status === 'PAID' ? '' : reason, updatedAt: nowIso() } : i));
  const next = await save(who, month, { ...p, instructions }, 'MARKED_' + status, `${target.name}${ref ? ' ' + ref : ''}${reason ? ': ' + reason : ''}`);
  return ok({ payment: view(next) });
}

async function paymentRetry(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const p = await needPayment(who, month);
  const only: string[] | null = Array.isArray(body?.uids) && body.uids.length ? body.uids.map((x: any) => String(x)) : null;
  const structures = await loadStructures(who.cid);
  let count = 0;
  const instructions = p.instructions.map((i: Instruction) => {
    if (!['FAILED', 'RETURNED', 'BLOCKED'].includes(i.status) || (only && !only.includes(i.uid))) return i;
    const st: any = structures.get(i.uid);
    const bankName = st?.bankName || i.bankName; const account = st?.bankAccount || ''; const ifsc = st?.ifsc || i.ifsc;
    if (!bankName || !account || !ifsc) return i; // still no details: stays blocked
    count++;
    return { ...i, bankName, ifsc, accountMasked: maskAccount(account), status: 'READY', reason: '', updatedAt: nowIso() };
  });
  if (!count) throw new PayrollError(409, 'Nothing to retry. Failed payments need valid bank details first.');
  const next = await save(who, month, { ...p, instructions }, 'RETRY', `${count} payments back to ready`);
  return ok({ payment: view(next), retried: count });
}

async function paymentExport(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const p = await loadPayment(who.cid, month);
  if (!p) throw new PayrollError(409, 'Prepare the bank payment first.');
  const [structures, lines, c] = await Promise.all([loadStructures(who.cid), loadLines(who.cid, month), loadControls(who.cid)]);
  const accountOf = (uid: string) => (structures.get(uid) as any)?.bankAccount || lines.find((l) => l.uid === uid)?.bank.account || '';
  const wanted = q.only === 'all' ? ['READY', 'SUBMITTED', 'FAILED', 'RETURNED', 'PAID'] : ['READY', 'SUBMITTED'];
  const rows = p.instructions.filter((i: Instruction) => wanted.includes(i.status)).map((i: Instruction) => [i.empId, i.name, i.bankName, accountOf(i.uid), i.ifsc, i.amount, `Salary ${month}`, c.entity.bankAccount, c.entity.bankIfsc]);
  return ok({
    month, header: ['Employee ID', 'Name', 'Bank', 'Account number', 'IFSC', 'Amount', 'Narration', 'Debit account', 'Debit IFSC'], rows,
    note: 'A generic layout, not your bank\'s upload format. A payment file is not proof that salary was paid: record the bank\'s response here.',
  });
}

async function paymentClose(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const p = await needPayment(who, month);
  const sum = paymentSummary(p.instructions);
  if (!sum.allPaid) {
    const left = sum.count - sum.by.PAID.count;
    throw new PayrollError(409, `${left} payment(s) are not confirmed paid yet (${sum.by.FAILED.count} failed, ${sum.by.RETURNED.count} returned, ${sum.by.BLOCKED.count} blocked, ${sum.by.READY.count + sum.by.SUBMITTED.count} waiting). Reconcile them first.`);
  }
  const run = await runOf(who.cid, month);
  if (!run || run.status !== 'LOCKED') throw new PayrollError(409, 'The run must be locked to close its payment.');
  const by = await actorName(who);
  const now = nowIso();
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.paidOn)) ? String(body.paidOn) : istToday();
  const nextRun: RunDoc = { ...run, status: 'PAID', paidAt: now, paidBy: by, paidOn, paidRef: p.batchRef || '', events: [...run.events, { at: now, by, action: 'PAID', note: `all ${sum.count} payments confirmed, on ${paidOn}` }].slice(-100) };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean(nextRun));
  const next = await save(who, month, p, 'CLOSED', 'reconciled', { status: 'CLOSED', closedAt: now, closedBy: by });
  return ok({ payment: view(next), run: nextRun });
}

// ------------------------------------------------------------------ salary versions

export async function recordVersion(cid: string, uid: string, v: { effectiveFrom: string; amounts: Record<string, number>; annualCtc: number; source: string; by: string; note?: string }) {
  const at = nowIso();
  // The first record of a person applies from the beginning; later ones apply from their own date.
  const first = (await db().collection('payrollSalaryVersions').where('companyId', '==', cid).where('uid', '==', uid).get()).empty;
  if (first) v = { ...v, effectiveFrom: '2000-01-01' };
  const id = `${cid}__${uid}__${v.effectiveFrom}__${at.replace(/\D/g, '').slice(0, 17)}`;
  await db().collection('payrollSalaryVersions').doc(id).set(clean({ companyId: cid, uid, ...v, at }));
}

async function salaryVersions(who: Who, q: any): Promise<Result> {
  needView(who);
  const uid = str(q.uid, 128);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const snap = await db().collection('payrollSalaryVersions').where('companyId', '==', who.cid).where('uid', '==', uid).get();
  const versions = snap.docs.map((d) => d.data() as SalaryVersion).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.at.localeCompare(a.at));
  const { settings } = await loadPayrollSettings(who.cid);
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(q.asOf)) ? String(q.asOf) : '';
  const grossOfAmounts = (a: Record<string, number>) => r2(settings.components.filter((c) => c.kind === 'EARNING' && c.active).reduce((n, c) => n + (a[c.id] || 0), 0));
  const inForce = asOf ? versionAsOf(versions, asOf) : null;
  return ok({
    person: { uid, name: person.name, empId: person.empId },
    versions: versions.map((v) => ({ ...v, gross: grossOfAmounts(v.amounts) })),
    asOf: asOf ? { date: asOf, version: inForce ? { ...inForce, gross: grossOfAmounts(inForce.amounts) } : null } : null,
  });
}

// ------------------------------------------------------------------ cost centres

async function costCentres(who: Who): Promise<Result> {
  needView(who);
  return ok({ items: (await loadControls(who.cid)).costCentres });
}

async function saveCostCentres(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadControls(who.cid);
  const list = Array.isArray(body?.items) ? body.items : [];
  const seen = new Set<string>();
  const next = list.map((x: any) => {
    const name = str(x?.name, 60);
    const id = str(x?.id, 30) || slugId(name);
    return { id, name, active: x?.active !== false };
  }).filter((x: any) => x.name && x.id);
  for (const x of next) { if (seen.has(x.id)) return fail(400, `Two cost centres have the same name or code: ${x.name}.`); seen.add(x.id); }
  // A cost centre that people are allocated to cannot disappear; it can only be switched off.
  const used = await db().collection('payrollCostAllocations').where('companyId', '==', who.cid).get();
  const missing = new Set<string>();
  used.docs.forEach((d) => (d.get('rows') || []).forEach((r: AllocRow) => { if (!seen.has(r.costCentreId)) missing.add(r.costCentreId); }));
  if (missing.size) return fail(409, `People are still allocated to ${[...missing].join(', ')}. Switch it off instead of removing it.`);
  c.costCentres = next;
  await saveControlsDoc(who.cid, c, await actorName(who));
  return ok({ items: next });
}

async function costAllocations(who: Who): Promise<Result> {
  needView(who);
  const snap = await db().collection('payrollCostAllocations').where('companyId', '==', who.cid).get();
  return ok({ items: snap.docs.map((d) => ({ uid: d.get('uid'), rows: d.get('rows') || [], updatedAt: d.get('updatedAt') || '' })) });
}

async function costAllocation(who: Who, q: any): Promise<Result> {
  needView(who);
  const uid = str(q.uid, 128);
  const s = await db().collection('payrollCostAllocations').doc(runId(who.cid, uid)).get();
  return ok({ uid, rows: s.exists ? s.get('rows') || [] : [], history: s.exists ? s.get('history') || [] : [] });
}

async function saveCostAllocation(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  if (!(await personByUid(who.cid, uid))) return fail(404, 'Employee not found.');
  const rows: AllocRow[] = (Array.isArray(body?.rows) ? body.rows : []).map((r: any) => ({ costCentreId: str(r?.costCentreId, 30), pct: Number(r?.pct) }));
  const c = await loadControls(who.cid);
  const why = allocationProblem(rows, c.costCentres);
  if (why) return fail(400, why);
  const ref = db().collection('payrollCostAllocations').doc(runId(who.cid, uid));
  const cur = await ref.get();
  const by = await actorName(who);
  const history = [{ at: nowIso(), by, rows: cur.exists ? cur.get('rows') || [] : [] }, ...(cur.exists ? cur.get('history') || [] : [])].slice(0, 10);
  await ref.set(clean({ companyId: who.cid, uid, rows, history, updatedAt: nowIso(), updatedBy: by }));
  return ok({});
}

async function costReport(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const [lines, alloc, c] = await Promise.all([loadLines(who.cid, month), db().collection('payrollCostAllocations').where('companyId', '==', who.cid).get(), loadControls(who.cid)]);
  if (!lines.length) return ok({ month, rows: [], total: 0, unallocated: [] });
  const byUid = new Map<string, AllocRow[]>();
  alloc.docs.forEach((d) => byUid.set(String(d.get('uid')), d.get('rows') || []));
  const names = new Map(c.costCentres.map((x) => [x.id, x.name]));
  const sums = new Map<string, { gross: number; employerCost: number; people: number }>();
  const unallocated: { uid: string; name: string }[] = [];
  const add = (id: string, gross: number, cost: number, person: boolean) => {
    const s = sums.get(id) || { gross: 0, employerCost: 0, people: 0 };
    s.gross = r2(s.gross + gross); s.employerCost = r2(s.employerCost + cost); if (person) s.people++;
    sums.set(id, s);
  };
  for (const l of lines) {
    const rows = byUid.get(l.uid) || [];
    if (!rows.length) { unallocated.push({ uid: l.uid, name: l.employee.name }); add('__none', l.line.gross, l.line.employerCost, true); continue; }
    const g = splitByAllocation(l.line.gross, rows);
    const e = splitByAllocation(l.line.employerCost, rows);
    rows.forEach((r, i) => add(r.costCentreId, g[i].amount, e[i].amount, true));
  }
  const out = [...sums.entries()].map(([id, s]) => ({ id, name: id === '__none' ? 'Not allocated' : names.get(id) || id, ...s })).sort((a, b) => b.employerCost - a.employerCost);
  return ok({ month, rows: out, total: r2(out.reduce((n, x) => n + x.employerCost, 0)), totalGross: r2(out.reduce((n, x) => n + x.gross, 0)), unallocated });
}

// ------------------------------------------------------------------ router

export async function routeControls(action: string, method: string, who: Who, body: any, query: any, deps: Deps): Promise<Result | null> {
  const GET = method === 'GET';
  const POST = method === 'POST';
  switch (action) {
    case 'controls': return GET ? controlsGet(who) : fail(405, 'Method not allowed.');
    case 'save-controls': return POST ? controlsSave(who, body) : fail(405, 'Method not allowed.');
    case 'approval-state': return GET ? approvalState(who, query) : fail(405, 'Method not allowed.');
    case 'approval-step': return POST ? approvalStep(who, body, deps) : fail(405, 'Method not allowed.');
    case 'calendar': return GET ? calendar(who, query) : fail(405, 'Method not allowed.');
    case 'period-freeze': return POST ? setPeriod(who, body, true) : fail(405, 'Method not allowed.');
    case 'period-unfreeze': return POST ? setPeriod(who, body, false) : fail(405, 'Method not allowed.');
    case 'payment': return GET ? paymentGet(who, query) : fail(405, 'Method not allowed.');
    case 'payment-create': return POST ? paymentCreate(who, body) : fail(405, 'Method not allowed.');
    case 'payment-submit': return POST ? paymentSubmit(who, body) : fail(405, 'Method not allowed.');
    case 'payment-import': return POST ? paymentImport(who, body) : fail(405, 'Method not allowed.');
    case 'payment-mark': return POST ? paymentMark(who, body) : fail(405, 'Method not allowed.');
    case 'payment-retry': return POST ? paymentRetry(who, body) : fail(405, 'Method not allowed.');
    case 'payment-export': return GET ? paymentExport(who, query) : fail(405, 'Method not allowed.');
    case 'payment-close': return POST ? paymentClose(who, body) : fail(405, 'Method not allowed.');
    case 'salary-versions': return GET ? salaryVersions(who, query) : fail(405, 'Method not allowed.');
    case 'cost-centres': return GET ? costCentres(who) : fail(405, 'Method not allowed.');
    case 'save-cost-centres': return POST ? saveCostCentres(who, body) : fail(405, 'Method not allowed.');
    case 'cost-allocations': return GET ? costAllocations(who) : fail(405, 'Method not allowed.');
    case 'cost-allocation': return GET ? costAllocation(who, query) : fail(405, 'Method not allowed.');
    case 'save-cost-allocation': return POST ? saveCostAllocation(who, body) : fail(405, 'Method not allowed.');
    case 'cost-report': return GET ? costReport(who, query) : fail(405, 'Method not allowed.');
    default: return null;
  }
}
