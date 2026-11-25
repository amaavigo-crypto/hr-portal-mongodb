import React, { useCallback, useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { inr, monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const TONE: Record<string, string> = {
  READY: 'bg-slate-100 text-slate-700', BLOCKED: 'bg-amber-100 text-amber-800', SUBMITTED: 'bg-sky-100 text-sky-800',
  PAID: 'bg-emerald-100 text-emerald-800', FAILED: 'bg-rose-100 text-rose-800', RETURNED: 'bg-rose-100 text-rose-800',
};

/** Salary payment after a run is locked: prepare the batch, send it, record what the bank says, and close it when everyone is paid. */
export const PaymentsTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [month, setMonth] = useState(previousMonth());
  const [pay, setPay] = useState<any | null>(null);
  const [runStatus, setRunStatus] = useState('');
  const [csv, setCsv] = useState('');
  const [ref, setRef] = useState('');
  const [mark, setMark] = useState<{ uid: string; status: string; ref: string; reason: string } | null>(null);
  const { busy, note, setNote, run } = useRunner();

  const load = useCallback(async () => {
    setNote(null);
    try {
      const [p, r] = await Promise.all([payrollService.payment(month), payrollService.run(month)]);
      setPay(p.payment); setRunStatus(r.run?.status || 'NONE');
    } catch (e: any) { setPay(null); setNote({ tone: 'error', text: e.message }); }
  }, [month, setNote]);
  useEffect(() => { load(); }, [load]);

  const act = (fn: () => Promise<any>, done: string) => run(async () => { try { await fn(); } finally { await load(); } }, done);
  const sum = pay?.summary;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Bank payment" subtitle="A payment file is not proof of payment. Salary is marked paid only when every payment is confirmed here."
        right={<div className="flex items-center gap-2">
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <span className="text-xs font-bold w-32 text-center">{monthLabel(month)}</span>
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>}>
        {!pay && runStatus !== 'LOCKED' && runStatus !== 'PAID' && <div className="text-xs text-slate-500">Lock the payroll run for this month first (Payroll run).</div>}
        {!pay && runStatus === 'LOCKED' && canManage && <button className={btnPrimary} disabled={busy} onClick={() => act(() => payrollService.paymentCreate(month), 'Payment batch prepared.')}>Prepare bank payment</button>}
        {pay && sum && (
          <>
            <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
              {Object.entries(sum.by).map(([k, v]: any) => <span key={k} className={`px-2.5 py-1 rounded-full font-bold ${TONE[k]}`}>{k.toLowerCase()} · {v.count} · {inr(v.amount)}</span>)}
              <span className="px-2.5 py-1 rounded-full font-bold bg-slate-900 text-white">{pay.status.toLowerCase()}</span>
            </div>
            {pay.debit?.accountMasked && <div className="text-xs text-slate-500 mb-2">Debit account {pay.debit.bankName} {pay.debit.accountMasked} · {pay.debit.ifsc}</div>}
            {canManage && pay.status !== 'CLOSED' && (
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <Field label="Batch reference"><input className={input} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy || sum.by.READY.count === 0} onClick={() => act(() => payrollService.paymentSubmit(month, ref), 'Marked as sent to the bank.')}>Mark ready payments as sent</button>
                <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await payrollService.paymentExport(month); downloadCsv(`bank-payment-${month}.csv`, [r.header, ...r.rows]); }, 'File downloaded. ' )}>Download bank file</button>
                <button className={btnGhost} disabled={busy} onClick={() => act(() => payrollService.paymentRetry(month), 'Moved back to ready.')}>Retry failed / blocked</button>
                <button className={btnPrimary} disabled={busy || !sum.allPaid} onClick={() => { if (window.confirm('Everyone is confirmed paid. Close the batch and mark the run as paid?')) act(() => payrollService.paymentClose(month), 'Closed. The run is marked paid.'); }}>Close and mark paid</button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead className="text-left text-slate-500"><tr><th className="p-1.5">Employee</th><th className="p-1.5">Bank</th><th className="p-1.5 text-right">Amount</th><th className="p-1.5">Status</th><th className="p-1.5">Reference / reason</th><th /></tr></thead>
                <tbody>
                  {pay.instructions.map((i: any) => (
                    <tr key={i.uid} className="border-t border-slate-100">
                      <td className="p-1.5"><b>{i.name}</b> <span className="text-slate-400">{i.empId}</span></td>
                      <td className="p-1.5">{i.bankName ? `${i.bankName} ${i.accountMasked}` : '—'}</td>
                      <td className="p-1.5 text-right tabular-nums">{inr(i.amount)}</td>
                      <td className="p-1.5"><span className={`px-2 py-0.5 rounded-full font-bold ${TONE[i.status]}`}>{i.status.toLowerCase()}</span></td>
                      <td className="p-1.5 text-slate-600">{i.ref || i.reason || ''}</td>
                      <td className="p-1.5 text-right">{canManage && pay.status !== 'CLOSED' && <button className="text-[#6d4cf0] font-bold" onClick={() => setMark({ uid: i.uid, status: 'PAID', ref: '', reason: '' })}>Record result</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mark && (
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <Field label="Result"><select className={input} value={mark.status} onChange={(e) => setMark({ ...mark, status: e.target.value })}><option value="PAID">Paid</option><option value="FAILED">Failed</option><option value="RETURNED">Returned</option></select></Field>
                {mark.status === 'PAID' ? <Field label="Bank reference (UTR)"><input className={input} value={mark.ref} onChange={(e) => setMark({ ...mark, ref: e.target.value })} /></Field>
                  : <Field label="Reason"><input className={input} value={mark.reason} onChange={(e) => setMark({ ...mark, reason: e.target.value })} /></Field>}
                <button className={btnPrimary} disabled={busy} onClick={() => act(() => payrollService.paymentMark({ month, ...mark }).then(() => setMark(null)), 'Recorded.')}>Save</button>
                <button className={btnGhost} onClick={() => setMark(null)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </Card>
      {pay && canManage && pay.status !== 'CLOSED' && (
        <Card title="Bank response" subtitle="Paste or upload the bank's result file. Columns: Employee ID, Status (paid / failed / returned), Reference or UTR, Reason.">
          <input type="file" accept=".csv,text/csv,text/plain" className="text-xs mb-2" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <textarea className={`${input} w-full h-24 font-mono`} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <button className={`${btnPrimary} mt-2`} disabled={busy || !csv.trim()} onClick={() => run(async () => { const r = await payrollService.paymentImport(month, csv); setCsv(''); setNote({ tone: 'ok', text: `${r.updated} updated${r.unknownEmployees?.length ? `; not found: ${r.unknownEmployees.join(', ')}` : ''}.` }); await load(); })}>Apply response</button>
        </Card>
      )}
      {pay?.events?.length > 0 && (
        <Card title="History"><ul className="text-[11px] text-slate-500 space-y-0.5">{[...pay.events].reverse().slice(0, 15).map((e: any, i: number) => <li key={i}>{e.at.slice(0, 16).replace('T', ' ')} · {e.action.toLowerCase().replace(/_/g, ' ')} · {e.by}{e.note ? ` · ${e.note}` : ''}</li>)}</ul></Card>
      )}
    </div>
  );
};
