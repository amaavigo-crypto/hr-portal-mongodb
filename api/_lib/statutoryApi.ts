/**
 * India statutory filings from a payroll run: PF ECR file, ESI upload file, LWF summary, TDS quarter data pack,
 * and challan tracking (what was deposited, when, against which challan). Routed from payrollApi as
 * /api/leave/payroll-statutory-* so it needs no extra serverless function.
 *
 *   payrollChallans/{id}   one deposit: authority, wage month, amount, date, challan/BSR details
 */
import { db, nowIso, str } from './leaveCore.js';
import { AUTHORITIES, dueDateFor, duesFor, ecrFile, esiFile, lwfSummary, quarterMonths, tdsQuarter, tdsQuarterCsv, type Authority, type StatLine } from '../../shared/statutoryFiles.js';
import { isIsoDate } from '../../shared/leaveEngine.js';
import { PayrollError, fail, loadLines, loadPayrollSettings, money, needManage, needMonth, needView, ok, runOf, type LineDoc, type Result, type Who } from './payrollKit.js';
import { randomUUID } from 'node:crypto';

const toStat = (l: LineDoc): StatLine => ({ employee: l.employee, line: l.line });

async function finishedLines(who: Who, month: string): Promise<LineDoc[]> {
  const run = await runOf(who.cid, month);
  if (!run || run.status === 'DRAFT') throw new PayrollError(409, 'Approve the run before exporting.');
  return loadLines(who.cid, month);
}

export async function loadChallans(cid: string): Promise<any[]> {
  const snap = await db().collection('payrollChallans').where('companyId', '==', cid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => String(b.month).localeCompare(String(a.month)) || String(a.authority).localeCompare(String(b.authority)));
}

/** What is due for a month, what has been deposited against it, and what is still open. */
async function dues(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const lines = await finishedLines(who, month);
  const challans = (await loadChallans(who.cid)).filter((c) => c.month === month);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const rows = duesFor(lines.map(toStat), month).filter((d) => d.amount > 0).map((d) => {
    const deposited = Math.round(challans.filter((c) => c.authority === d.authority).reduce((n, c) => n + (Number(c.amount) || 0), 0) * 100) / 100;
    const open = Math.round((d.amount - deposited) * 100) / 100;
    return { ...d, deposited, open, overdue: open > 0 && !!d.dueDate && d.dueDate < today };
  });
  return ok({ month, rows, challans });
}

async function file(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const lines = (await finishedLines(who, month)).map(toStat);
  const { settings: s } = await loadPayrollSettings(who.cid);
  const kind = str(q.kind, 10);
  if (kind === 'ecr') {
    const r = ecrFile(lines, { wageCeiling: s.pf.wageCeiling });
    return ok({ month, kind, filename: `ECR_${month.replace('-', '')}.txt`, ...r });
  }
  if (kind === 'esi') {
    const r = esiFile(lines);
    return ok({ month, kind, filename: `ESI_${month.replace('-', '')}.csv`, ...r });
  }
  if (kind === 'lwf') return ok({ month, kind, ...lwfSummary(lines) });
  return fail(400, 'Unknown file.');
}

async function tds(who: Who, q: any): Promise<Result> {
  needView(who);
  const fy = str(q.fy, 9);
  if (!/^\d{4}(-\d{2,4})?$/.test(fy)) return fail(400, 'Financial year looks like 2026-27.');
  const quarter = Number(q.quarter);
  if (![1, 2, 3, 4].includes(quarter)) return fail(400, 'Quarter must be 1 to 4.');
  const { settings: s } = await loadPayrollSettings(who.cid);
  const runs: { month: string; lines: StatLine[] }[] = [];
  for (const month of quarterMonths(fy, quarter as 1 | 2 | 3 | 4)) {
    const run = await runOf(who.cid, month);
    if (run && run.status !== 'DRAFT') runs.push({ month, lines: (await loadLines(who.cid, month)).map(toStat) });
  }
  const challans = (await loadChallans(who.cid)).filter((c) => c.authority === 'TDS').map((c) => ({ month: c.month, amount: Number(c.amount) || 0, paidOn: c.paidOn, reference: c.reference, bsrCode: c.bsrCode, challanSerial: c.challanNo }));
  const pack = tdsQuarter({ fy, quarter: quarter as 1 | 2 | 3 | 4, tan: s.company.tan, pan: s.company.pan, legalName: s.company.legalName, runs, challans });
  return ok({ ...pack, csv: tdsQuarterCsv(pack), filename: `TDS_${fy}_Q${quarter}.csv` });
}

async function saveChallan(who: Who, body: any): Promise<Result> {
  needManage(who);
  const authority = str(body.authority, 5).toUpperCase() as Authority;
  if (!AUTHORITIES.includes(authority)) return fail(400, 'Choose PF, ESI, PT, TDS or LWF.');
  const month = needMonth(body.month);
  const amount = money(body.amount, 'Amount');
  if (!(amount > 0)) return fail(400, 'Enter the amount deposited.');
  const paidOn = str(body.paidOn, 10);
  if (paidOn && !isIsoDate(paidOn)) return fail(400, 'Deposit date must be a valid date.');
  const id = str(body.id, 60) || randomUUID();
  const prev = await db().collection('payrollChallans').doc(id).get();
  if (prev.exists && (prev.data() as any).companyId !== who.cid) return fail(404, 'Challan not found.');
  const doc = {
    companyId: who.cid, authority, month, amount, paidOn, challanNo: str(body.challanNo, 40), bsrCode: str(body.bsrCode, 12), reference: str(body.reference, 80),
    dueDate: dueDateFor(authority, month), updatedBy: who.ctx.uid, updatedAt: nowIso(), ...(prev.exists ? {} : { createdAt: nowIso() }),
  };
  await db().collection('payrollChallans').doc(id).set(doc, { merge: true });
  return ok({ id, ...doc });
}

async function deleteChallan(who: Who, body: any): Promise<Result> {
  needManage(who);
  const id = str(body.id, 60);
  const ref = db().collection('payrollChallans').doc(id);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as any).companyId !== who.cid) return fail(404, 'Challan not found.');
  await ref.delete();
  return ok({ deleted: true });
}

/** Returns undefined when the action is not a statutory one. */
export async function routeStatutory(action: string, method: string, who: Who, body: any, query: any): Promise<Result | undefined> {
  const GET = method === 'GET', POST = method === 'POST';
  switch (action) {
    case 'statutory-dues': if (GET) return dues(who, query); break;
    case 'statutory-file': if (GET) return file(who, query); break;
    case 'statutory-tds': if (GET) return tds(who, query); break;
    case 'challans': if (GET) { needView(who); return ok({ items: await loadChallans(who.cid) }); } break;
    case 'save-challan': if (POST) return saveChallan(who, body); break;
    case 'delete-challan': if (POST) return deleteChallan(who, body); break;
  }
  return undefined;
}
