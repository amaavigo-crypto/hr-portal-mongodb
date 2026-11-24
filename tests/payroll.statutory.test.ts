import assert from 'node:assert/strict';
import { calculateLine, labourWelfareFund, payDaysFor, starterPayrollSettings, totalsOf, type SalaryStructure } from '../shared/payrollEngine.ts';
import { dueDateFor, duesFor, ecrFile, esiFile, lwfSummary, quarterMonths, tdsQuarter, tdsQuarterCsv, type StatLine } from '../shared/statutoryFiles.ts';

// ---- LWF in the engine
const s = starterPayrollSettings();
const basicId = s.components.find((c) => c.isBasic)!.id;
const st: SalaryStructure = { amounts: { [basicId]: 20000 }, state: 'Maharashtra', gender: 'M', pfApplicable: true, esicApplicable: false, pfOnActualWage: false };
const calc = (settings: any, month: string, paid?: number) => {
  const payDays = payDaysFor(settings, month);
  return calculateLine({ settings, structure: st, month, paidDays: paid ?? payDays, payDays, encashDays: 0, adjustments: [], loanRecoveries: [] });
};

assert.deepEqual(labourWelfareFund(s, 'Maharashtra', '2026-06', 30), { employee: 0, employer: 0 }, 'off by default');
const base = calc(s, '2026-06');
assert.equal(base.statutory.lwfEmployee, undefined);

const withLwf = { ...s, lwf: { enabled: true, states: { Maharashtra: { months: [6, 12], employee: 25, employer: 75 } } } };
assert.deepEqual(labourWelfareFund(withLwf, 'Maharashtra', '2026-06', 30), { employee: 25, employer: 75 });
assert.deepEqual(labourWelfareFund(withLwf, 'Maharashtra', '2026-07', 30), { employee: 0, employer: 0 }, 'only in listed months');
assert.deepEqual(labourWelfareFund(withLwf, 'Maharashtra', '2026-06', 0), { employee: 0, employer: 0 }, 'nothing when not paid');
assert.deepEqual(labourWelfareFund(withLwf, 'Kerala', '2026-06', 30), { employee: 0, employer: 0 }, 'state without a rate');
const jun = calc(withLwf, '2026-06');
assert.equal(jun.statutory.lwfEmployee, 25);
assert.equal(jun.totalDeductions, Math.round((base.totalDeductions + 25) * 100) / 100, 'employee share is deducted');
assert.equal(jun.net, Math.round((base.net - 25) * 100) / 100);
assert.equal(jun.employerCost, Math.round((base.employerCost + 75) * 100) / 100, 'employer share is cost');
const t = totalsOf([jun, base]);
assert.equal(t.lwfEmployee, 25); assert.equal(t.lwfEmployer, 75);
assert.equal(totalsOf([base]).lwfEmployee, undefined);
const noRate = calc({ ...s, lwf: { enabled: true, states: {} } }, '2026-06');
assert.ok(noRate.warnings.some((w: string) => /Labour Welfare/.test(w)), 'warns when no rate is set');

// ---- ECR file
const mk = (empId: string, name: string, over: any = {}, stat: any = {}, line: any = {}): StatLine => ({
  employee: { empId, name, uan: '100200300400', esicNo: '1234567890', pan: 'ABCDE1234F', state: 'Maharashtra', ...over },
  line: { gross: 30000, paidDays: 30, payDays: 30, tds: 0, statutory: { pfWage: 20000, pfEmployee: 1800, pfEmployer: 1800, edli: 100, pfAdmin: 100, esicWage: 0, esicEmployee: 0, esicEmployer: 0, pt: 200, ...stat }, ...line },
});
const lines = [mk('E1', "Asha O'Neil"), mk('E2', 'No Uan', { uan: '' }), mk('E3', 'High Wage', {}, { pfWage: 40000, pfEmployee: 4800, pfEmployer: 4800 }, { paidDays: 28 })];
const ecr = ecrFile(lines, { wageCeiling: 15000 });
assert.equal(ecr.rows, 2);
assert.equal(ecr.problems.length, 1); assert.match(ecr.problems[0], /No Uan/);
const [r1, r3] = ecr.text.trim().split('\n').map((l) => l.split('#~#'));
assert.equal(r1.length, 11);
assert.equal(r1[1], 'ASHA O NEIL', 'name uppercased and cleaned');
assert.deepEqual(r1.slice(2), ['30000', '20000', '15000', '15000', '1800', '1250', '550', '0', '0']);
assert.equal(r3[3], '40000'); assert.equal(r3[4], '15000', 'EPS wages capped at the ceiling');
assert.equal(r3[9], '2', 'non-contributing days');
assert.equal(Number(r1[6]) + Number(r1[7]) + Number(r1[8]), 1800 + 1800);

// ---- ESI file
const esiLines = [
  mk('E1', 'Covered', {}, { esicWage: 18000, esicEmployee: 135, esicEmployer: 585 }),
  mk('E2', 'Bad No', { esicNo: '12' }, { esicWage: 18000, esicEmployee: 135, esicEmployer: 585 }),
  mk('E3', 'Not Covered'),
  mk('E4', 'Zero Days', {}, { esicWage: 0, esicEmployee: 0, esicEmployer: 0 }, { paidDays: 0 }),
];
const esi = esiFile(esiLines);
assert.equal(esi.rows, 1); assert.equal(esi.problems.length, 1);
assert.match(esi.text.split('\n')[1], /^1234567890,"Covered",30,18000,0,$/);
assert.equal(esi.total, 720);

// ---- LWF summary and dues
const lw = lwfSummary([mk('E1', 'A', {}, { lwfEmployee: 25, lwfEmployer: 75 }), mk('E2', 'B', { state: 'Karnataka' }, { lwfEmployee: 20, lwfEmployer: 40 }), mk('E3', 'C')]);
assert.equal(lw.rows.length, 2); assert.equal(lw.employee, 45); assert.equal(lw.employer, 115);

assert.equal(dueDateFor('PF', '2026-11'), '2026-12-15');
assert.equal(dueDateFor('ESI', '2026-12'), '2027-01-15');
assert.equal(dueDateFor('TDS', '2026-11'), '2026-12-07');
assert.equal(dueDateFor('TDS', '2027-03'), '2027-04-30');
assert.equal(dueDateFor('PT', '2026-11'), '');
const dues = duesFor(lines, '2026-11');
assert.equal(dues.find((d) => d.authority === 'PF')!.amount, 3800 + 3800 + 9800);
assert.equal(dues.find((d) => d.authority === 'PT')!.amount, 600);

// ---- TDS quarter
assert.deepEqual(quarterMonths('2026-27', 1), ['2026-04', '2026-05', '2026-06']);
assert.deepEqual(quarterMonths('2026-27', 4), ['2027-01', '2027-02', '2027-03']);
const tl = (m: string) => ({ month: m, lines: [mk('E1', 'Asha', {}, {}, { tds: 1000 }), mk('E2', 'No Pan', { pan: '' }, {}, { tds: 500 }), mk('E3', 'Zero')] });
const pack = tdsQuarter({
  fy: '2026-27', quarter: 3, tan: 'MUMA12345B', pan: 'AAACA1234A', legalName: 'Acme',
  runs: [tl('2026-10'), tl('2026-11'), tl('2026-12'), tl('2026-09')],
  challans: [{ month: '2026-10', amount: 1500, paidOn: '2026-11-05', bsrCode: '0510308', challanSerial: '00012' }, { month: '2026-11', amount: 1500 }, { month: '2026-05', amount: 99 }],
});
assert.equal(pack.deductees.length, 2, 'zero-TDS people left out');
assert.equal(pack.totals.deducted, 4500);
assert.equal(pack.totals.deposited, 3000);
assert.equal(pack.totals.difference, 1500);
assert.ok(pack.problems.some((p) => /No Pan.*PAN/.test(p)));
assert.ok(pack.problems.some((p) => /2026-11 TDS challan is missing/.test(p)));
assert.ok(pack.problems.some((p) => /short payment/.test(p)));
const bad = tdsQuarter({ fy: '2026-27', quarter: 1, tan: '', pan: 'x', legalName: '', runs: [], challans: [] });
assert.equal(bad.problems.filter((p) => /TAN|PAN/.test(p)).length, 2);
const csv = tdsQuarterCsv(pack);
assert.match(csv, /^Deductor,"Acme"/); assert.match(csv, /Total deducted,4500/);

console.log('payroll.statutory ok');
