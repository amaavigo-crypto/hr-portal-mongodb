/**
 * Payroll controls: pure rules shared by the API and the browser (no database).
 *
 *   - three-step approval (HR, Finance, signatory) and who may take which step
 *   - separation of duties (the person who prepares or edits payroll must not approve or release it)
 *   - payroll calendar (cut-off and pay date) and the input freeze
 *   - bank payment instructions and reconciling a bank response
 *   - cost-centre allocation
 *   - effective-dated salary versions
 */

export type Step = 'HR' | 'FINANCE' | 'SIGNATORY';
export const STEPS: Step[] = ['HR', 'FINANCE', 'SIGNATORY'];
export const STEP_LABEL: Record<Step, string> = { HR: 'HR verification', FINANCE: 'Finance verification', SIGNATORY: 'Final authorisation' };

export interface Entity {
  pfRegNo: string; esiRegNo: string; ptRegNo: string; lwfRegNo: string;
  bankName: string; bankAccount: string; bankIfsc: string; branch: string;
}
export interface CostCentre { id: string; name: string; active: boolean }
export interface Period {
  status: 'OPEN' | 'FROZEN';
  at?: string; by?: string;
  log: { at: string; by: string; action: string; note: string }[];
}
export interface Controls {
  chain: { enabled: boolean; hr: string[]; finance: string[]; signatory: string[] };
  sod: { enabled: boolean };
  calendar: { enabled: boolean; cutoffDay: number; payDay: number; requireFreeze: boolean };
  entity: Entity;
  costCentres: CostCentre[];
  periods: Record<string, Period>;
}

export const emptyEntity = (): Entity => ({ pfRegNo: '', esiRegNo: '', ptRegNo: '', lwfRegNo: '', bankName: '', bankAccount: '', bankIfsc: '', branch: '' });

export const defaultControls = (): Controls => ({
  chain: { enabled: false, hr: [], finance: [], signatory: [] },
  sod: { enabled: false },
  calendar: { enabled: false, cutoffDay: 3, payDay: 7, requireFreeze: false },
  entity: emptyEntity(),
  costCentres: [],
  periods: {},
});

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const uidList = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, 128)).filter(Boolean))].slice(0, 20);
const day = (v: unknown, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(28, Math.max(1, n)) : dflt; };
export const slugId = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Merge a saved document with the defaults, so a document written before a field existed still works. */
export function readControls(raw: any): Controls {
  const d = defaultControls();
  if (!raw || typeof raw !== 'object') return d;
  return {
    chain: { enabled: raw.chain?.enabled === true, hr: uidList(raw.chain?.hr), finance: uidList(raw.chain?.finance), signatory: uidList(raw.chain?.signatory) },
    sod: { enabled: raw.sod?.enabled === true },
    calendar: { enabled: raw.calendar?.enabled === true, cutoffDay: day(raw.calendar?.cutoffDay, d.calendar.cutoffDay), payDay: day(raw.calendar?.payDay, d.calendar.payDay), requireFreeze: raw.calendar?.requireFreeze === true },
    entity: { ...d.entity, ...Object.fromEntries(Object.keys(d.entity).map((k) => [k, text(raw.entity?.[k], 60)])) },
    costCentres: Array.isArray(raw.costCentres) ? raw.costCentres.map((c: any) => ({ id: text(c?.id, 30), name: text(c?.name, 60), active: c?.active !== false })).filter((c: CostCentre) => c.id && c.name) : [],
    periods: raw.periods && typeof raw.periods === 'object' ? raw.periods : {},
  };
}

/** Validate the settings a person typed in. Returns the cleaned settings or an error sentence. */
export function checkControls(input: any, prev: Controls): { controls?: Controls; error?: string } {
  const c: Controls = {
    ...prev,
    chain: { enabled: input?.chain?.enabled === true, hr: uidList(input?.chain?.hr), finance: uidList(input?.chain?.finance), signatory: uidList(input?.chain?.signatory) },
    sod: { enabled: input?.sod?.enabled === true },
    calendar: { enabled: input?.calendar?.enabled === true, cutoffDay: day(input?.calendar?.cutoffDay, 3), payDay: day(input?.calendar?.payDay, 7), requireFreeze: input?.calendar?.requireFreeze === true },
    entity: { ...emptyEntity(), ...Object.fromEntries(Object.keys(emptyEntity()).map((k) => [k, text(input?.entity?.[k], 60)])) },
    costCentres: prev.costCentres,
  };
  if (c.chain.enabled) {
    if (!c.chain.hr.length || !c.chain.finance.length || !c.chain.signatory.length) return { error: 'Choose at least one person for each of the three approval steps before turning the approval chain on.' };
  }
  if (c.entity.bankIfsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(c.entity.bankIfsc)) return { error: 'The bank IFSC code looks wrong (4 letters, a zero, then 6 letters or digits).' };
  c.entity.bankIfsc = c.entity.bankIfsc.toUpperCase();
  if (c.entity.bankAccount && !/^[0-9A-Za-z]{6,24}$/.test(c.entity.bankAccount.replace(/\s+/g, ''))) return { error: 'The company bank account number looks wrong.' };
  c.entity.bankAccount = c.entity.bankAccount.replace(/\s+/g, '');
  return { controls: c };
}

// ------------------------------------------------------------------ approval chain

export interface Approval { uid: string; name: string; at: string; hash: string; note?: string }
export type Approvals = Partial<Record<Step, Approval>>;

export const nextStep = (a: Approvals | undefined): Step | null => STEPS.find((s) => !a?.[s]) ?? null;

export interface ApprovalFacts {
  controls: Controls;
  uid: string;
  step: Step;
  approvals: Approvals | undefined;
  /** People who calculated or changed this run (and so are its "makers"). */
  touchedBy: string[];
  /** Whoever edited a salary structure in the payroll month or the month before. */
  salaryEditors: string[];
}

/** '' when this person may take this step now, otherwise a plain-words reason. */
export function stepProblem(f: ApprovalFacts): string {
  const list = f.step === 'HR' ? f.controls.chain.hr : f.step === 'FINANCE' ? f.controls.chain.finance : f.controls.chain.signatory;
  if (!list.includes(f.uid)) return `You are not one of the people chosen for ${STEP_LABEL[f.step].toLowerCase()}.`;
  const expected = nextStep(f.approvals);
  if (expected !== f.step) return expected ? `The next step is ${STEP_LABEL[expected].toLowerCase()}.` : 'All three approvals are done.';
  const earlier = STEPS.slice(0, STEPS.indexOf(f.step)).map((s) => f.approvals?.[s]?.uid);
  if (earlier.includes(f.uid)) return 'The same person cannot take two approval steps.';
  if (f.controls.sod.enabled && f.step !== 'HR') {
    if (f.touchedBy.includes(f.uid)) return 'You prepared or changed this payroll, so someone else must approve it.';
    if (f.salaryEditors.includes(f.uid)) return 'You changed a salary this payroll period, so someone else must approve it.';
  }
  return '';
}

/** Rules for the single-step approve, the lock and the payment release when the chain is off. */
export function dutyProblem(controls: Controls, uid: string, duty: 'APPROVE' | 'RELEASE', touchedBy: string[], approvers: string[], salaryEditors: string[]): string {
  if (!controls.sod.enabled) return '';
  if (touchedBy.includes(uid)) return duty === 'APPROVE' ? 'You prepared or changed this payroll, so someone else must approve it.' : 'You prepared or changed this payroll, so someone else must release the payment.';
  if (salaryEditors.includes(uid)) return 'You changed a salary this payroll period, so someone else must ' + (duty === 'APPROVE' ? 'approve' : 'release the payment for') + ' it.';
  if (duty === 'RELEASE' && approvers.includes(uid)) return 'You approved this payroll, so someone else must release the payment.';
  return '';
}

// ------------------------------------------------------------------ calendar

const pad = (n: number) => String(n).padStart(2, '0');
export function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}
export function periodDates(month: string, cal: Controls['calendar']): { cutoff: string; payDate: string } {
  const n = nextMonthOf(month);
  return { cutoff: `${n}-${pad(cal.cutoffDay)}`, payDate: `${n}-${pad(cal.payDay)}` };
}
export const periodOf = (c: Controls, month: string): Period => c.periods[month] ?? { status: 'OPEN', log: [] };

export type Stage = 'NOT_OPENED' | 'INPUT_COLLECTION' | 'INPUTS_LOCKED' | 'CALCULATED' | 'IN_APPROVAL' | 'APPROVED' | 'LOCKED' | 'PAYMENT' | 'PAID';
export const STAGE_LABEL: Record<Stage, string> = {
  NOT_OPENED: 'Not opened', INPUT_COLLECTION: 'Collecting inputs', INPUTS_LOCKED: 'Inputs frozen', CALCULATED: 'Calculated, waiting for review', IN_APPROVAL: 'In approval',
  APPROVED: 'Approved', LOCKED: 'Locked, ready to pay', PAYMENT: 'Payment in progress', PAID: 'Paid',
};
export function stageOf(runStatus: string | null, approvals: Approvals | undefined, frozen: boolean, hasPayment: boolean): Stage {
  if (runStatus === 'PAID') return 'PAID';
  if (runStatus === 'LOCKED') return hasPayment ? 'PAYMENT' : 'LOCKED';
  if (runStatus === 'APPROVED') return 'APPROVED';
  if (runStatus === 'DRAFT') return approvals && Object.keys(approvals).length ? 'IN_APPROVAL' : frozen ? 'INPUTS_LOCKED' : 'CALCULATED';
  return frozen ? 'INPUTS_LOCKED' : 'INPUT_COLLECTION';
}

// ------------------------------------------------------------------ bank payments

export type PayStatus = 'READY' | 'BLOCKED' | 'SUBMITTED' | 'PAID' | 'FAILED' | 'RETURNED';
export interface Instruction {
  uid: string; empId: string; name: string; amount: number;
  bankName: string; accountMasked: string; ifsc: string;
  status: PayStatus; ref: string; reason: string; tries: number; updatedAt: string;
}

export function buildInstructions(lines: { uid: string; empId: string; name: string; net: number; bankName: string; account: string; ifsc: string }[], mask: (a: string) => string, now: string): Instruction[] {
  return lines.filter((l) => l.net > 0).map((l) => {
    const missing = !l.account || !l.ifsc || !l.bankName;
    return {
      uid: l.uid, empId: l.empId, name: l.name, amount: l.net, bankName: l.bankName, accountMasked: mask(l.account), ifsc: l.ifsc,
      status: missing ? 'BLOCKED' : 'READY', ref: '', reason: missing ? 'Bank details are missing' : '', tries: 0, updatedAt: now,
    };
  });
}

export function parseStatus(v: unknown): PayStatus | '' {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['paid', 'success', 'successful', 'processed', 'credited', 'completed', 'settled'].includes(s)) return 'PAID';
  if (['failed', 'fail', 'rejected', 'declined', 'error', 'unsuccessful'].includes(s)) return 'FAILED';
  if (['returned', 'return', 'reversed', 'reversal', 'refunded'].includes(s)) return 'RETURNED';
  return '';
}

export interface BankRow { empId: string; status: PayStatus | ''; ref: string; reason: string }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const split = (line: string): string[] => {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
};

/** CSV from the bank or the payments team: Employee ID, Status, Reference (UTR), Reason. */
export function parseBankResponse(csv: string, maxRows = 5000): { rows: BankRow[]; problems: string[] } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], problems: ['The file has no rows.'] };
  const head = split(lines[0]).map(norm);
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iId = find(['employeeid', 'empid', 'employeecode', 'empcode', 'code', 'id']);
  const iSt = find(['status', 'paymentstatus', 'result']);
  const iRef = find(['reference', 'utr', 'utrno', 'transactionid', 'txnid', 'ref', 'bankreference']);
  const iWhy = find(['reason', 'remarks', 'remark', 'message', 'failurereason']);
  if (iId < 0 || iSt < 0) return { rows: [], problems: ['The first row must name an Employee ID column and a Status column.'] };
  const problems: string[] = [];
  const rows: BankRow[] = [];
  lines.slice(1, maxRows + 1).forEach((l, i) => {
    const c = split(l);
    const empId = (c[iId] || '').trim();
    const status = parseStatus(c[iSt]);
    if (!empId) { if (problems.length < 20) problems.push(`Row ${i + 2}: no employee id.`); return; }
    rows.push({ empId, status, ref: iRef >= 0 ? (c[iRef] || '').slice(0, 60) : '', reason: iWhy >= 0 ? (c[iWhy] || '').slice(0, 200) : '' });
  });
  return { rows, problems };
}

/** Apply a bank response to the instructions. Only instructions that were submitted can change. */
export function applyBankRows(instr: Instruction[], rows: BankRow[], now: string): { instructions: Instruction[]; updated: number; unknown: string[]; skipped: string[] } {
  const byEmp = new Map(instr.map((i) => [i.empId.trim().toLowerCase(), i]));
  const next = instr.map((i) => ({ ...i }));
  const unknown: string[] = []; const skipped: string[] = [];
  let updated = 0;
  for (const r of rows) {
    const key = r.empId.trim().toLowerCase();
    if (!byEmp.has(key)) { if (unknown.length < 50) unknown.push(r.empId); continue; }
    if (!r.status) continue; // pending or unreadable: leave as it is
    const t = next.find((i) => i.uid === byEmp.get(key)!.uid)!;
    if (!['SUBMITTED', 'FAILED', 'RETURNED', 'PAID'].includes(t.status)) { if (skipped.length < 50) skipped.push(`${t.name}: not submitted yet`); continue; }
    if (t.status === r.status && (!r.ref || r.ref === t.ref)) continue;
    t.status = r.status; if (r.ref) t.ref = r.ref;
    t.reason = r.status === 'PAID' ? '' : r.reason; t.updatedAt = now; updated++;
  }
  return { instructions: next, updated, unknown, skipped };
}

export function paymentSummary(instr: Instruction[]) {
  const by: Record<PayStatus, { count: number; amount: number }> = {
    READY: { count: 0, amount: 0 }, BLOCKED: { count: 0, amount: 0 }, SUBMITTED: { count: 0, amount: 0 }, PAID: { count: 0, amount: 0 }, FAILED: { count: 0, amount: 0 }, RETURNED: { count: 0, amount: 0 },
  };
  for (const i of instr) { by[i.status].count++; by[i.status].amount = Math.round((by[i.status].amount + i.amount) * 100) / 100; }
  const total = Math.round(instr.reduce((n, i) => n + i.amount, 0) * 100) / 100;
  return { by, total, count: instr.length, allPaid: instr.length > 0 && instr.every((i) => i.status === 'PAID') };
}

// ------------------------------------------------------------------ cost centres

export interface AllocRow { costCentreId: string; pct: number }
export function allocationProblem(rows: AllocRow[], centres: CostCentre[]): string {
  if (!rows.length) return '';
  const ids = new Set<string>();
  let total = 0;
  for (const r of rows) {
    if (!centres.some((c) => c.id === r.costCentreId && c.active)) return 'Choose cost centres from the list.';
    if (ids.has(r.costCentreId)) return 'A cost centre can appear only once.';
    ids.add(r.costCentreId);
    if (!Number.isFinite(r.pct) || r.pct <= 0 || r.pct > 100) return 'Each share must be above 0 and at most 100.';
    total += r.pct;
  }
  return Math.abs(total - 100) > 0.001 ? `The shares add up to ${Math.round(total * 100) / 100}%, they must add up to 100%.` : '';
}

/** Split an amount by percentage in paise, so the parts always add up to the whole. */
export function splitByAllocation(amount: number, rows: AllocRow[]): { costCentreId: string; amount: number }[] {
  const paise = Math.round(amount * 100);
  let used = 0;
  return rows.map((r, i) => {
    const part = i === rows.length - 1 ? paise - used : Math.round((paise * r.pct) / 100);
    used += part;
    return { costCentreId: r.costCentreId, amount: part / 100 };
  });
}

// ------------------------------------------------------------------ salary versions

export interface SalaryVersion { effectiveFrom: string; amounts: Record<string, number>; annualCtc: number; source: string; by: string; at: string; note?: string }
/** The version in force on a date: the latest one that starts on or before it. */
export function versionAsOf(versions: SalaryVersion[], date: string): SalaryVersion | null {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.at.localeCompare(b.at));
  let found: SalaryVersion | null = null;
  for (const v of sorted) if (v.effectiveFrom <= date) found = v;
  return found;
}
