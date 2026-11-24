import React, { useCallback, useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { inr, monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const save = (name: string, text: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};
const fyOf = (month: string) => { const y = +month.slice(0, 4), m = +month.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
const quarterOf = (month: string) => { const m = +month.slice(5, 7); return m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4; };

/** What is due to PF, ESI, PT, TDS and LWF for a month, files to upload, deposits made, and the TDS quarter data pack. */
export const StatutoryTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [month, setMonth] = useState(previousMonth());
  const [dues, setDues] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [ch, setCh] = useState({ authority: 'PF', amount: '', paidOn: '', challanNo: '', bsrCode: '', reference: '' });
  const [tds, setTds] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    setErr(null);
    try { setDues(await payrollService.statutoryDues(month)); } catch (e: any) { setDues(null); setErr(e.message); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { payrollService.settings().then((r) => setSettings(r.settings)).catch(() => undefined); }, []);

  const file = (kind: 'ecr' | 'esi' | 'lwf') => run(async () => {
    const r = await payrollService.statutoryFile(month, kind);
    setProblems(r.problems || []);
    if (kind === 'lwf') downloadCsv(`LWF-${month}.csv`, [r.header, ...r.rows]);
    else save(r.filename, r.text, kind === 'esi' ? 'text/csv' : 'text/plain');
  });

  const lwf = settings?.lwf || { enabled: false, states: {} };
  const setLwf = (next: any) => setSettings({ ...settings, lwf: next });
  const states: string[] = Object.keys(lwf.states);

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Dues and deposits" right={
        <div className="flex items-center gap-2">
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <span className="text-xs font-bold w-32 text-center">{monthLabel(month)}</span>
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>}>
        {err && <Notice tone="warn">{err}</Notice>}
        {dues && (
          <table className="text-xs w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Authority</th><th className="p-1.5 text-right">Due</th><th className="p-1.5 text-right">Deposited</th><th className="p-1.5 text-right">Open</th><th className="p-1.5">Due date</th></tr></thead>
            <tbody>
              {dues.rows.map((d: any) => (
                <tr key={d.authority} className="border-t border-slate-100">
                  <td className="p-1.5 font-semibold">{d.authority}</td><td className="p-1.5 text-right tabular-nums">{inr(d.amount)}</td>
                  <td className="p-1.5 text-right tabular-nums">{inr(d.deposited)}</td>
                  <td className={`p-1.5 text-right tabular-nums font-bold ${d.overdue ? 'text-red-600' : ''}`}>{inr(d.open)}</td>
                  <td className="p-1.5">{d.dueDate || 'Varies by state'}{d.overdue ? ' · overdue' : ''}</td>
                </tr>
              ))}
              {dues.rows.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-400">Nothing is due for this month.</td></tr>}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-slate-400 mt-2">Due dates are the usual ones (PF and ESI on the 15th, TDS on the 7th of the next month). Professional tax and LWF dates depend on the state.</p>
      </Card>

      {dues && (
        <Card title="Files to upload">
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => file('ecr')}>PF ECR file (.txt)</button>
            <button className={btnPrimary} disabled={busy} onClick={() => file('esi')}>ESI upload file (.csv)</button>
            <button className={btnGhost} disabled={busy} onClick={() => file('lwf')}>LWF summary (.csv)</button>
          </div>
          {problems.length > 0 && <div className="mt-3"><Notice tone="warn"><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice></div>}
          <p className="text-[11px] text-slate-400 mt-2">Portals change their layouts now and then. Upload a small test file first.</p>
        </Card>
      )}

      <Card title="Deposits (challans)">
        {canManage && (
          <div className="grid md:grid-cols-7 gap-2 items-end mb-3">
            <Field label="For"><select className={input} value={ch.authority} onChange={(e) => setCh({ ...ch, authority: e.target.value })}>{['PF', 'ESI', 'PT', 'TDS', 'LWF'].map((a) => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Amount (₹)"><input type="number" className={input} value={ch.amount} onChange={(e) => setCh({ ...ch, amount: e.target.value })} /></Field>
            <Field label="Paid on"><input type="date" className={input} value={ch.paidOn} onChange={(e) => setCh({ ...ch, paidOn: e.target.value })} /></Field>
            <Field label="Challan no."><input className={input} value={ch.challanNo} onChange={(e) => setCh({ ...ch, challanNo: e.target.value })} /></Field>
            <Field label="BSR code"><input className={input} value={ch.bsrCode} onChange={(e) => setCh({ ...ch, bsrCode: e.target.value })} /></Field>
            <Field label="Reference"><input className={input} value={ch.reference} onChange={(e) => setCh({ ...ch, reference: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveChallan({ ...ch, month, amount: Number(ch.amount) }); setCh({ ...ch, amount: '', challanNo: '', reference: '' }); await load(); })}>Record</button>
          </div>
        )}
        <table className="text-xs w-full">
          <tbody>
            {(dues?.challans || []).map((c: any) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="p-1.5 font-semibold">{c.authority}</td><td className="p-1.5 text-right tabular-nums">{inr(c.amount)}</td>
                <td className="p-1.5">{c.paidOn || 'date not set'}</td><td className="p-1.5 text-slate-500">{[c.challanNo, c.bsrCode, c.reference].filter(Boolean).join(' · ')}</td>
                <td className="p-1.5 text-right">{canManage && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.deleteChallan(c.id); await load(); })}>Delete</button>}</td>
              </tr>
            ))}
            {!(dues?.challans || []).length && <tr><td className="p-3 text-slate-400">No deposits recorded for {monthLabel(month)}.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="TDS return data (quarter)">
        <div className="flex items-center gap-2 mb-2">
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => setTds(await payrollService.statutoryTds(fyOf(month), quarterOf(month))))}>Prepare FY {fyOf(month)} Q{quarterOf(month)}</button>
          {tds && <button className={btnGhost} onClick={() => save(tds.filename, tds.csv, 'text/csv')}>Download data (.csv)</button>}
        </div>
        {tds && (
          <>
            <p className="text-xs text-slate-600">Deducted {inr(tds.totals.deducted)} · deposited {inr(tds.totals.deposited)} · difference {inr(tds.totals.difference)} · {tds.deductees.length} employees</p>
            {tds.problems.length > 0 && <div className="mt-2"><Notice tone="warn"><ul className="list-disc pl-4">{tds.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></Notice></div>}
          </>
        )}
        <p className="text-[11px] text-slate-400 mt-2">This is the data to key into the TDS return utility (Form 24Q). It is not the NSDL file itself, which only NSDL's own validator can produce.</p>
      </Card>

      {settings && (
        <Card title="Labour Welfare Fund">
          <label className="flex items-center gap-2 text-xs mb-2"><input type="checkbox" disabled={!canManage} checked={!!lwf.enabled} onChange={(e) => setLwf({ ...lwf, enabled: e.target.checked })} /> Deduct LWF in payroll</label>
          <p className="text-[11px] text-slate-400 mb-2">Rates differ by state and change. Enter the amounts from your state's notification; none are pre-filled.</p>
          {states.map((st) => (
            <div key={st} className="grid grid-cols-5 gap-2 items-end mb-2">
              <div className="text-xs font-semibold">{st}</div>
              <Field label="Months (e.g. 6,12)"><input className={input} disabled={!canManage} value={lwf.states[st].months.join(',')} onChange={(e) => setLwf({ ...lwf, states: { ...lwf.states, [st]: { ...lwf.states[st], months: e.target.value.split(',').map((x) => +x.trim()).filter((x) => x >= 1 && x <= 12) } } })} /></Field>
              <Field label="Employee ₹"><input type="number" className={input} disabled={!canManage} value={lwf.states[st].employee} onChange={(e) => setLwf({ ...lwf, states: { ...lwf.states, [st]: { ...lwf.states[st], employee: Number(e.target.value) } } })} /></Field>
              <Field label="Employer ₹"><input type="number" className={input} disabled={!canManage} value={lwf.states[st].employer} onChange={(e) => setLwf({ ...lwf, states: { ...lwf.states, [st]: { ...lwf.states[st], employer: Number(e.target.value) } } })} /></Field>
              {canManage && <button className={btnDanger} onClick={() => { const n = { ...lwf.states }; delete n[st]; setLwf({ ...lwf, states: n }); }}>Remove</button>}
            </div>
          ))}
          {canManage && (
            <div className="flex gap-2 items-center">
              <select className={input + ' max-w-xs'} value="" onChange={(e) => e.target.value && setLwf({ ...lwf, states: { ...lwf.states, [e.target.value]: { months: [6, 12], employee: 0, employer: 0 } } })}>
                <option value="">Add a state…</option>
                {(settings.pt?.states ? Object.keys(settings.pt.states) : []).concat(['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'Delhi', 'Kerala', 'Telangana', 'Andhra Pradesh', 'West Bengal']).filter((v, i, a) => a.indexOf(v) === i && !lwf.states[v]).map((v) => <option key={v}>{v}</option>)}
              </select>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveSettings(settings); })}>Save LWF settings</button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
