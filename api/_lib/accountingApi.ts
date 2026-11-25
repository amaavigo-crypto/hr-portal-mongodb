/**
 * Accounting export of a finished payroll run, as /api/leave/payroll-accounting-*.
 *   accountingMappings/{companyId}   which ledger name each posting goes to
 */
import { db, nowIso, str } from './leaveCore.js';
import { LEDGER_KEYS, LEDGER_LABELS, buildJournal, defaultLedgers, quickbooksCsv, tallyXml, type LedgerMap } from '../../shared/accountingExport.js';
import { PayrollError, fail, loadLines, loadPayrollSettings, needManage, needMonth, needView, ok, runOf, type Result, type Who } from './payrollKit.js';

async function loadMap(cid: string): Promise<LedgerMap> {
  const snap = await db().collection('accountingMappings').doc(cid).get();
  return { ...defaultLedgers(), ...((snap.exists ? (snap.data() as any).ledgers : null) || {}) };
}

async function getMapping(who: Who): Promise<Result> {
  needView(who);
  const snap = await db().collection('accountingMappings').doc(who.cid).get();
  return ok({ ledgers: await loadMap(who.cid), labels: LEDGER_LABELS, keys: LEDGER_KEYS, configured: snap.exists, company: str(snap.exists ? (snap.data() as any).tallyCompany : '', 120) });
}

async function saveMapping(who: Who, body: any): Promise<Result> {
  needManage(who);
  const ledgers: Partial<LedgerMap> = {};
  for (const k of LEDGER_KEYS) {
    const v = str(body?.ledgers?.[k], 100);
    if (v) ledgers[k] = v;
  }
  await db().collection('accountingMappings').doc(who.cid).set({ companyId: who.cid, ledgers, tallyCompany: str(body?.company, 120), updatedBy: who.ctx.uid, updatedAt: nowIso() });
  return ok({ ledgers: { ...defaultLedgers(), ...ledgers } });
}

async function exportJournal(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const run = await runOf(who.cid, month);
  if (!run || run.status === 'DRAFT') return fail(409, 'Approve the run before exporting.');
  const lines = await loadLines(who.cid, month);
  if (!lines.length) return fail(409, 'The run has no payslips.');
  const snap = await db().collection('accountingMappings').doc(who.cid).get();
  const journal = buildJournal(month, lines.map((l) => l.line), await loadMap(who.cid));
  const { settings } = await loadPayrollSettings(who.cid);
  const company = str(snap.exists ? (snap.data() as any).tallyCompany : '', 120) || settings.company.legalName;
  const format = str(q.format, 12);
  if (format === 'tally') return ok({ month, format, journal, filename: `Payroll_${month}_Tally.xml`, text: tallyXml(journal, { company }) });
  if (format === 'quickbooks') {
    const df = str(q.dateFormat, 12);
    return ok({ month, format, journal, filename: `Payroll_${month}_QuickBooks.csv`, text: quickbooksCsv(journal, { dateFormat: df === 'MM/DD/YYYY' || df === 'YYYY-MM-DD' ? df : 'DD/MM/YYYY' }) });
  }
  if (format === 'preview') return ok({ month, format, journal });
  return fail(400, 'Choose tally, quickbooks or preview.');
}

export async function routeAccounting(action: string, method: string, who: Who, body: any, query: any): Promise<Result | undefined> {
  try {
    switch (action) {
      case 'accounting-mapping': if (method === 'GET') return await getMapping(who); break;
      case 'save-accounting-mapping': if (method === 'POST') return await saveMapping(who, body); break;
      case 'accounting-export': if (method === 'GET') return await exportJournal(who, query); break;
    }
  } catch (err) {
    if (err instanceof PayrollError) return fail(err.status, err.message);
    throw err;
  }
  return undefined;
}
