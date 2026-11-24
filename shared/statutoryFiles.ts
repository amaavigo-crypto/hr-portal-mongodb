/**
 * Statutory filing files built from a finished payroll run. Pure functions, no database.
 *
 *   ecrFile        PF: the monthly ECR text file (ECR 2.0, fields joined by #~#) for upload on the EPFO employer portal
 *   esiFile        ESI: the monthly contribution rows for the ESIC portal upload
 *   lwfSummary     Labour Welfare Fund: state-wise totals for the month
 *   duesFor        what is due to each authority for a month, and the due date
 *   tdsQuarter     TDS: the quarter's deductee-wise data and challan reconciliation (the data pack to key into the
 *                  TDS return utility; this is NOT the NSDL FVU file itself)
 *
 * Nothing here decides rates: every amount comes from the run's own lines. File layouts follow the portals' published
 * formats as understood when this was written; the portals change them, so upload a small test file first.
 */
import type { PayrollLine } from './payrollEngine.js';

export interface StatLine {
  employee: { empId: string; name: string; uan?: string; esicNo?: string; pan?: string; state?: string };
  line: Pick<PayrollLine, 'gross' | 'paidDays' | 'payDays' | 'tds' | 'statutory'>;
}

const r0 = (n: number) => Math.round(Number.isFinite(n) ? n : 0);
const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
export const AUTHORITIES = ['PF', 'ESI', 'PT', 'TDS', 'LWF'] as const;
export type Authority = (typeof AUTHORITIES)[number];

export interface FileResult { text: string; rows: number; total: number; problems: string[] }

// ------------------------------------------------------------------ PF: ECR

/** EPFO wants capital letters and plain characters in the member name. */
export const ecrName = (n: string) => n.toUpperCase().replace(/[^A-Z .]/g, ' ').replace(/\s+/g, ' ').trim();
export const isUan = (v: string | undefined) => /^\d{12}$/.test(String(v || '').trim());

/**
 * ECR 2.0. One line per member:
 * UAN #~# name #~# gross wages #~# EPF wages #~# EPS wages #~# EDLI wages #~# EPF contribution (employee) #~# EPS contribution
 * #~# EPF-EPS difference (employer) #~# non-contributing days #~# refund of advances.
 * EPS wages and EDLI wages are capped at the wage ceiling; the EPS share is 8.33% of EPS wages and the rest of the
 * employer's contribution goes to the difference column.
 */
export function ecrFile(lines: StatLine[], opts: { wageCeiling: number; epsPct?: number }): FileResult {
  const epsPct = opts.epsPct ?? 8.33;
  const problems: string[] = [];
  const out: string[] = [];
  let total = 0;
  for (const l of lines) {
    const s = l.line.statutory;
    if (!(s.pfWage > 0) && !(s.pfEmployee > 0)) continue;
    if (!isUan(l.employee.uan)) {
      problems.push(`${l.employee.name} (${l.employee.empId}) has no valid 12-digit UAN, so is left out of the file.`);
      continue;
    }
    const epfWages = r0(s.pfWage);
    const epsWages = Math.min(epfWages, r0(opts.wageCeiling));
    const edliWages = Math.min(epfWages, r0(opts.wageCeiling));
    const eps = Math.min(r0((epsWages * epsPct) / 100), r0(s.pfEmployer));
    const diff = Math.max(0, r0(s.pfEmployer) - eps);
    const ncp = Math.max(0, r0(l.line.payDays - l.line.paidDays));
    out.push([l.employee.uan!.trim(), ecrName(l.employee.name), r0(l.line.gross), epfWages, epsWages, edliWages, r0(s.pfEmployee), eps, diff, ncp, 0].join('#~#'));
    total += r0(s.pfEmployee) + eps + diff;
  }
  return { text: out.join('\n') + (out.length ? '\n' : ''), rows: out.length, total, problems };
}

// ------------------------------------------------------------------ ESI

export const isEsiNo = (v: string | undefined) => /^\d{10}$|^\d{17}$/.test(String(v || '').trim());
/** Reason codes the ESIC portal asks for when a member worked no days; 0 means "worked". 1 is "without wages". */
export const ESI_REASON_NO_WAGES = 1;

export function esiFile(lines: StatLine[]): FileResult & { header: string[] } {
  const header = ['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons)', 'Last Working Day(dd/mm/yyyy)'];
  const problems: string[] = [];
  const rows: string[] = [];
  let total = 0;
  for (const l of lines) {
    const s = l.line.statutory;
    const covered = s.esicEmployee > 0 || (!!l.employee.esicNo && s.esicWage > 0);
    if (!covered) continue;
    if (!isEsiNo(l.employee.esicNo)) {
      problems.push(`${l.employee.name} (${l.employee.empId}) has no valid ESIC IP number (10 or 17 digits), so is left out of the file.`);
      continue;
    }
    const days = r0(l.line.paidDays);
    const zero = days <= 0;
    rows.push([l.employee.esicNo!.trim(), `"${l.employee.name.replace(/"/g, '')}"`, days, zero ? 0 : r0(s.esicWage), zero ? ESI_REASON_NO_WAGES : 0, ''].join(','));
    total += r0(s.esicEmployee) + r0(s.esicEmployer);
  }
  return { header, text: [header.join(','), ...rows].join('\n') + '\n', rows: rows.length, total, problems };
}

// ------------------------------------------------------------------ LWF

export function lwfSummary(lines: StatLine[]): { header: string[]; rows: (string | number)[][]; employee: number; employer: number } {
  const byState = new Map<string, { n: number; ee: number; er: number }>();
  for (const l of lines) {
    const ee = l.line.statutory.lwfEmployee || 0, er = l.line.statutory.lwfEmployer || 0;
    if (!ee && !er) continue;
    const k = l.employee.state || 'Not set';
    const v = byState.get(k) || { n: 0, ee: 0, er: 0 };
    v.n += 1; v.ee += ee; v.er += er;
    byState.set(k, v);
  }
  const rows = [...byState.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([state, v]) => [state, v.n, r2(v.ee), r2(v.er), r2(v.ee + v.er)] as (string | number)[]);
  return {
    header: ['State', 'Employees', 'Employee share', 'Employer share', 'Total'],
    rows, employee: r2([...byState.values()].reduce((n, v) => n + v.ee, 0)), employer: r2([...byState.values()].reduce((n, v) => n + v.er, 0)),
  };
}

// ------------------------------------------------------------------ dues and due dates

export interface Due { authority: Authority; amount: number; dueDate: string }

const nextMonth = (month: string) => {
  const y = parseInt(month.slice(0, 4), 10), m = parseInt(month.slice(5, 7), 10);
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Usual due dates for the wage month: PF and ESI by the 15th of the next month, TDS by the 7th of the next month
 * (for March, 30 April). Professional tax and Labour Welfare Fund dates differ by state, so no date is given for them.
 */
export function dueDateFor(authority: Authority, month: string): string {
  const n = nextMonth(month);
  if (authority === 'PF' || authority === 'ESI') return iso(n.y, n.m, 15);
  if (authority === 'TDS') return month.slice(5, 7) === '03' ? iso(n.y, n.m, 30) : iso(n.y, n.m, 7);
  return '';
}

export function duesFor(lines: StatLine[], month: string): Due[] {
  const sum = (f: (l: StatLine) => number) => r2(lines.reduce((n, l) => n + f(l), 0));
  const amounts: Record<Authority, number> = {
    // PF challan: employee share, employer share, EDLI and admin charges (the portal splits them into accounts)
    PF: sum((l) => l.line.statutory.pfEmployee + l.line.statutory.pfEmployer + l.line.statutory.edli + l.line.statutory.pfAdmin),
    ESI: sum((l) => l.line.statutory.esicEmployee + l.line.statutory.esicEmployer),
    PT: sum((l) => l.line.statutory.pt),
    TDS: sum((l) => l.line.tds || 0),
    LWF: sum((l) => (l.line.statutory.lwfEmployee || 0) + (l.line.statutory.lwfEmployer || 0)),
  };
  return AUTHORITIES.map((a) => ({ authority: a, amount: amounts[a], dueDate: dueDateFor(a, month) }));
}

// ------------------------------------------------------------------ TDS quarter (data pack for the return utility)

export const isPan = (v: string | undefined) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v || '').trim().toUpperCase());

/** Indian financial year quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export function quarterMonths(fy: string, quarter: 1 | 2 | 3 | 4): string[] {
  const start = parseInt(fy.slice(0, 4), 10);
  const m = quarter === 1 ? [4, 5, 6] : quarter === 2 ? [7, 8, 9] : quarter === 3 ? [10, 11, 12] : [1, 2, 3];
  return m.map((x) => `${quarter === 4 ? start + 1 : start}-${String(x).padStart(2, '0')}`);
}

export interface TdsChallan { month: string; amount: number; paidOn?: string; reference?: string; bsrCode?: string; challanSerial?: string }

export function tdsQuarter(input: {
  fy: string; quarter: 1 | 2 | 3 | 4; tan: string; pan: string; legalName: string;
  runs: { month: string; lines: StatLine[] }[]; challans: TdsChallan[];
}) {
  const months = quarterMonths(input.fy, input.quarter);
  const problems: string[] = [];
  if (!/^[A-Z]{4}\d{5}[A-Z]$/.test(input.tan.trim().toUpperCase())) problems.push('The company TAN is missing or not in the TAN format (4 letters, 5 digits, 1 letter). Set it under Payroll > Setup > Company.');
  if (!isPan(input.pan)) problems.push('The company PAN is missing or not in the PAN format. Set it under Payroll > Setup > Company.');

  const people = new Map<string, { empId: string; name: string; pan: string; byMonth: Record<string, number>; gross: number }>();
  for (const run of input.runs) {
    if (!months.includes(run.month)) continue;
    for (const l of run.lines) {
      const key = l.employee.empId;
      const p = people.get(key) || { empId: l.employee.empId, name: l.employee.name, pan: String(l.employee.pan || '').toUpperCase(), byMonth: {}, gross: 0 };
      p.byMonth[run.month] = r2((p.byMonth[run.month] || 0) + (l.line.tds || 0));
      p.gross = r2(p.gross + l.line.gross);
      people.set(key, p);
    }
  }
  const deductees = [...people.values()].filter((p) => Object.values(p.byMonth).some((v) => v > 0)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const total = r2(months.reduce((n, m) => n + (p.byMonth[m] || 0), 0));
    if (!isPan(p.pan)) problems.push(`${p.name} (${p.empId}) has no valid PAN. The return needs it (and tax is deducted at a higher rate without one).`);
    return { empId: p.empId, name: p.name, pan: p.pan, months: months.map((m) => p.byMonth[m] || 0), total, gross: p.gross };
  });

  const deducted = r2(deductees.reduce((n, d) => n + d.total, 0));
  const challans = input.challans.filter((c) => months.includes(c.month));
  const deposited = r2(challans.reduce((n, c) => n + c.amount, 0));
  for (const c of challans) {
    if (!c.paidOn || !c.bsrCode || !c.challanSerial) problems.push(`The ${c.month} TDS challan is missing its deposit date, BSR code or challan serial number.`);
  }
  if (deducted > deposited) problems.push(`Tax deducted (${deducted}) is more than tax deposited (${deposited}) for this quarter. Record the missing challan or the return will show a short payment.`);
  if (deposited > deducted) problems.push(`Tax deposited (${deposited}) is more than tax deducted (${deducted}). Check the challan amounts.`);

  return {
    fy: input.fy, quarter: input.quarter, months, tan: input.tan.trim().toUpperCase(), pan: input.pan.trim().toUpperCase(), legalName: input.legalName,
    deductees, challans, totals: { deducted, deposited, difference: r2(deducted - deposited) }, problems,
  };
}

/** The data pack as CSV text: deductee rows, then challan rows. */
export function tdsQuarterCsv(p: ReturnType<typeof tdsQuarter>): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = [`Deductor,${q(p.legalName)}`, `TAN,${p.tan}`, `PAN,${p.pan}`, `Financial year,${p.fy}`, `Quarter,Q${p.quarter}`, ''];
  const ded = ['Deductees', ['Employee ID', 'Name', 'PAN', ...p.months.map((m) => `TDS ${m}`), 'Total TDS', 'Gross paid'].join(','),
    ...p.deductees.map((d) => [d.empId, q(d.name), d.pan, ...d.months, d.total, d.gross].join(',')), ''];
  const ch = ['Challans', 'Wage month,Amount,Deposit date,Challan serial,BSR code,Reference',
    ...p.challans.map((c) => [c.month, c.amount, c.paidOn || '', c.challanSerial || '', c.bsrCode || '', q(c.reference || '')].join(',')), '',
    `Total deducted,${p.totals.deducted}`, `Total deposited,${p.totals.deposited}`, `Difference,${p.totals.difference}`];
  return [...head, ...ded, ...ch].join('\n') + '\n';
}
