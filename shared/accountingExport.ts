/**
 * Payroll journal for the accounts team: one balanced voucher per month, as a Tally import XML or a QuickBooks
 * Online journal-entry CSV. Pure functions, no database. The ledger NAMES come from the company's own mapping; they
 * must already exist in the accounting software.
 *
 *   Dr  Salary expense             gross pay + reimbursements
 *   Dr  Employer PF / ESI / LWF    employer shares (PF includes EDLI and admin charges)
 *   Cr  Salary payable             net pay
 *   Cr  PF / ESI / PT / TDS / LWF payable    employee and employer shares
 *   Cr  Other deductions           loans, advances and other recoveries
 */
import type { PayrollLine } from './payrollEngine.js';

export const LEDGER_KEYS = [
  'salaryExpense', 'employerPfExpense', 'employerEsiExpense', 'employerLwfExpense',
  'salaryPayable', 'pfPayable', 'esiPayable', 'ptPayable', 'tdsPayable', 'lwfPayable', 'otherDeductions',
] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type LedgerMap = Record<LedgerKey, string>;

export const LEDGER_LABELS: Record<LedgerKey, string> = {
  salaryExpense: 'Salary expense', employerPfExpense: 'Employer PF expense (incl. EDLI, admin)', employerEsiExpense: 'Employer ESI expense', employerLwfExpense: 'Employer LWF expense',
  salaryPayable: 'Salary payable (net pay)', pfPayable: 'PF payable', esiPayable: 'ESI payable', ptPayable: 'Professional tax payable', tdsPayable: 'TDS on salary payable', lwfPayable: 'LWF payable', otherDeductions: 'Other deductions / recoveries',
};

export const defaultLedgers = (): LedgerMap => ({
  salaryExpense: 'Salaries and Wages', employerPfExpense: 'Employer PF Contribution', employerEsiExpense: 'Employer ESI Contribution', employerLwfExpense: 'Employer LWF Contribution',
  salaryPayable: 'Salary Payable', pfPayable: 'PF Payable', esiPayable: 'ESI Payable', ptPayable: 'Professional Tax Payable', tdsPayable: 'TDS on Salary Payable', lwfPayable: 'LWF Payable', otherDeductions: 'Employee Recoveries',
});

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export interface Entry { ledger: string; key: LedgerKey; debit: number; credit: number }
export interface Journal { month: string; date: string; entries: Entry[]; debit: number; credit: number; balanced: boolean; problems: string[] }

export const lastDayOf = (month: string) => {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export function buildJournal(month: string, lines: Pick<PayrollLine, 'gross' | 'totalDeductions' | 'net' | 'tds' | 'reimbursementTotal' | 'statutory'>[], map: Partial<LedgerMap> = {}): Journal {
  const L = { ...defaultLedgers(), ...Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string' && v.trim())) } as LedgerMap;
  const sum = (f: (l: (typeof lines)[number]) => number) => r2(lines.reduce((n, l) => n + (f(l) || 0), 0));
  const gross = sum((l) => l.gross), reimb = sum((l) => l.reimbursementTotal || 0);
  const pfEe = sum((l) => l.statutory.pfEmployee), pfEr = sum((l) => l.statutory.pfEmployer + l.statutory.edli + l.statutory.pfAdmin);
  const esiEe = sum((l) => l.statutory.esicEmployee), esiEr = sum((l) => l.statutory.esicEmployer);
  const pt = sum((l) => l.statutory.pt), tds = sum((l) => l.tds || 0);
  const lwfEe = sum((l) => l.statutory.lwfEmployee || 0), lwfEr = sum((l) => l.statutory.lwfEmployer || 0);
  const net = sum((l) => l.net), totalDed = sum((l) => l.totalDeductions);
  const other = r2(totalDed - pfEe - esiEe - pt - tds - lwfEe);

  const raw: Entry[] = [
    { key: 'salaryExpense', ledger: L.salaryExpense, debit: r2(gross + reimb), credit: 0 },
    { key: 'employerPfExpense', ledger: L.employerPfExpense, debit: pfEr, credit: 0 },
    { key: 'employerEsiExpense', ledger: L.employerEsiExpense, debit: esiEr, credit: 0 },
    { key: 'employerLwfExpense', ledger: L.employerLwfExpense, debit: lwfEr, credit: 0 },
    { key: 'salaryPayable', ledger: L.salaryPayable, debit: 0, credit: net },
    { key: 'pfPayable', ledger: L.pfPayable, debit: 0, credit: r2(pfEe + pfEr) },
    { key: 'esiPayable', ledger: L.esiPayable, debit: 0, credit: r2(esiEe + esiEr) },
    { key: 'ptPayable', ledger: L.ptPayable, debit: 0, credit: pt },
    { key: 'tdsPayable', ledger: L.tdsPayable, debit: 0, credit: tds },
    { key: 'lwfPayable', ledger: L.lwfPayable, debit: 0, credit: r2(lwfEe + lwfEr) },
    { key: 'otherDeductions', ledger: L.otherDeductions, debit: 0, credit: other > 0 ? other : 0 },
  ];
  const entries = raw.filter((e) => e.debit > 0 || e.credit > 0);
  const debit = r2(entries.reduce((n, e) => n + e.debit, 0)), credit = r2(entries.reduce((n, e) => n + e.credit, 0));
  const problems: string[] = [];
  if (!entries.length) problems.push('The run has no amounts to post.');
  const diff = r2(debit - credit);
  // net pay is floored at zero when deductions exceed pay, which leaves the voucher unbalanced by the shortfall
  if (Math.abs(diff) >= 0.01) problems.push(`The voucher is out by ${diff} (debits ${debit}, credits ${credit}). This usually means someone's deductions were more than their pay. Check the run's shortfall warnings before posting.`);
  if (other < 0) problems.push(`Deductions listed as statutory are ${-other} more than the total deducted. Check the run.`);
  return { month, date: lastDayOf(month), entries, debit, credit, balanced: Math.abs(diff) < 0.01, problems };
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const money = (n: number) => n.toFixed(2);

/** Tally Prime / ERP 9 "Import Data" XML with one Journal voucher. Debits are deemed positive with a negative amount. */
export function tallyXml(j: Journal, o: { company: string; voucherNo?: string; narration?: string }): string {
  const no = o.voucherNo || `PAY-${j.month}`;
  const narration = o.narration || `Payroll for ${j.month}`;
  const rows = j.entries.map((e) => [
    '        <ALLLEDGERENTRIES.LIST>',
    `          <LEDGERNAME>${xml(e.ledger)}</LEDGERNAME>`,
    `          <ISDEEMEDPOSITIVE>${e.debit > 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    `          <AMOUNT>${e.debit > 0 ? '-' + money(e.debit) : money(e.credit)}</AMOUNT>`,
    '        </ALLLEDGERENTRIES.LIST>',
  ].join('\n')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    `      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${o.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(o.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ''}</REQUESTDESC>`,
    '      <REQUESTDATA>',
    '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `        <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `        <DATE>${j.date.replace(/-/g, '')}</DATE>`,
    '        <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>',
    `        <VOUCHERNUMBER>${xml(no)}</VOUCHERNUMBER>`,
    `        <NARRATION>${xml(narration)}</NARRATION>`,
    rows,
    '        </VOUCHER>',
    '        </TALLYMESSAGE>',
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');
}

const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** QuickBooks Online journal-entry import CSV. `dateFormat` must match the setting of the QuickBooks company. */
export function quickbooksCsv(j: Journal, o: { journalNo?: string; dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'; description?: string } = {}): string {
  const [y, m, d] = j.date.split('-');
  const date = o.dateFormat === 'MM/DD/YYYY' ? `${m}/${d}/${y}` : o.dateFormat === 'YYYY-MM-DD' ? j.date : `${d}/${m}/${y}`;
  const no = o.journalNo || `PAY-${j.month}`;
  const desc = o.description || `Payroll for ${j.month}`;
  const head = 'Journal No,Journal Date,Account Name,Debits,Credits,Description';
  return [head, ...j.entries.map((e) => [q(no), date, q(e.ledger), e.debit > 0 ? money(e.debit) : '', e.credit > 0 ? money(e.credit) : '', q(desc)].join(','))].join('\n') + '\n';
}
