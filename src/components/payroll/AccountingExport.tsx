import React, { useEffect, useState } from 'react';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const save = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};

/** The month's payroll as one balanced journal voucher for Tally or QuickBooks, with the company's own ledger names. */
export const AccountingExport: React.FC<{ month: string; canManage: boolean }> = ({ month, canManage }) => {
  const [map, setMap] = useState<any | null>(null);
  const [company, setCompany] = useState('');
  const [journal, setJournal] = useState<any | null>(null);
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const { busy, note, run } = useRunner();
  useEffect(() => { payrollService.accountingMapping().then((r) => { setMap(r); setCompany(r.company || ''); }).catch(() => undefined); }, []);
  useEffect(() => { setJournal(null); }, [month]);

  const download = (format: 'tally' | 'quickbooks') => run(async () => {
    const r = await payrollService.accountingExport(month, format, dateFormat);
    setJournal(r.journal);
    save(r.filename, r.text, format === 'tally' ? 'application/xml' : 'text/csv');
  });

  return (
    <Card title="Accounting export (Tally, QuickBooks)">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <button className={btnPrimary} disabled={busy} onClick={() => download('tally')}>Tally XML · {monthLabel(month)}</button>
        <button className={btnPrimary} disabled={busy} onClick={() => download('quickbooks')}>QuickBooks CSV</button>
        <Field label="QuickBooks date format"><select className={input} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></Field>
      </div>
      {journal && (
        <>
          {journal.problems.map((p: string) => <Notice key={p} tone="warn">{p}</Notice>)}
          <table className="text-xs w-full mt-2">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Ledger</th><th className="p-1.5 text-right">Debit</th><th className="p-1.5 text-right">Credit</th></tr></thead>
            <tbody>
              {journal.entries.map((e: any) => <tr key={e.key} className="border-t border-slate-100"><td className="p-1.5">{e.ledger}</td><td className="p-1.5 text-right tabular-nums">{e.debit ? inr(e.debit) : ''}</td><td className="p-1.5 text-right tabular-nums">{e.credit ? inr(e.credit) : ''}</td></tr>)}
              <tr className="border-t border-slate-300 font-bold"><td className="p-1.5">Total</td><td className="p-1.5 text-right tabular-nums">{inr(journal.debit)}</td><td className="p-1.5 text-right tabular-nums">{inr(journal.credit)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      {map && canManage && (
        <details className="mt-3">
          <summary className="text-xs font-bold cursor-pointer">Ledger names</summary>
          <p className="text-[11px] text-slate-400 my-2">These must match ledgers that already exist in your accounting software.</p>
          <div className="grid md:grid-cols-2 gap-2">
            <Field label="Tally company name (optional)"><input className={input} value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            {map.keys.map((k: string) => <Field key={k} label={map.labels[k]}><input className={input} value={map.ledgers[k]} onChange={(e) => setMap({ ...map, ledgers: { ...map.ledgers, [k]: e.target.value } })} /></Field>)}
          </div>
          <button className={btnGhost + ' mt-2'} disabled={busy} onClick={() => run(async () => { await payrollService.saveAccountingMapping({ company, ledgers: map.ledgers }); })}>Save ledger names</button>
        </details>
      )}
      <p className="text-[11px] text-slate-400 mt-2">One journal voucher dated the last day of the month. Import it in a test company first.</p>
    </Card>
  );
};
