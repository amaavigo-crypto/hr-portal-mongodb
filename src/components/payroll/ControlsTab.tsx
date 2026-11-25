import React, { useCallback, useEffect, useState } from 'react';
import { inr, monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

type Person = { uid: string; name: string; empId: string };
const STEP_ROWS: [string, string][] = [['hr', 'HR verification'], ['finance', 'Finance verification'], ['signatory', 'Final authorisation']];

/** Company-level payroll controls (admin), cost centres with employee splits, the cost report, and a person's salary history. */
export const ControlsTab: React.FC<{ canManage: boolean; isAdmin: boolean }> = ({ canManage, isAdmin }) => {
  const [c, setC] = useState<any | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [centres, setCentres] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<string, any[]>>({});
  const [uid, setUid] = useState('');
  const [rows, setRows] = useState<{ costCentreId: string; pct: string }[]>([]);
  const [month, setMonth] = useState(previousMonth());
  const [report, setReport] = useState<any | null>(null);
  const [vers, setVers] = useState<any | null>(null);
  const { busy, note, setNote, run } = useRunner();

  const load = useCallback(async () => {
    try {
      const r = await payrollService.controls();
      setC(r.controls); setPeople(r.people); setCentres(r.controls.costCentres);
      const a = await payrollService.costAllocations();
      setAlloc(Object.fromEntries(a.items.map((x: any) => [x.uid, x.rows])));
    } catch (e: any) { setNote({ tone: 'error', text: e.message }); }
  }, [setNote]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { payrollService.costReport(month).then(setReport).catch(() => setReport(null)); }, [month, alloc, centres]);
  useEffect(() => { setRows((alloc[uid] || []).map((r: any) => ({ costCentreId: r.costCentreId, pct: String(r.pct) }))); }, [uid, alloc]);
  useEffect(() => { if (uid) payrollService.salaryVersions(uid).then(setVers).catch(() => setVers(null)); else setVers(null); }, [uid]);

  if (!c) return note ? <Notice tone="error">{note.text}</Notice> : <div className="text-xs text-slate-500">Loading…</div>;
  const set = (path: string[], v: any) => { const n = JSON.parse(JSON.stringify(c)); let o = n; path.slice(0, -1).forEach((k) => (o = o[k])); o[path[path.length - 1]] = v; setC(n); };
  const toggle = (step: string, id: string) => { const cur: string[] = c.chain[step]; set(['chain', step], cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); };
  const total = rows.reduce((n, r) => n + (Number(r.pct) || 0), 0);

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Approval and separation of duties" subtitle={isAdmin ? 'Everything here is off until you turn it on.' : 'Only a company admin can change these.'}>
        <fieldset disabled={!isAdmin || busy} className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={c.chain.enabled} onChange={(e) => set(['chain', 'enabled'], e.target.checked)} /> Approve payroll in three steps (HR, Finance, final authorisation)</label>
          {STEP_ROWS.map(([k, label]) => (
            <div key={k}>
              <div className="text-xs font-semibold text-slate-600 mb-1">{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => <button key={p.uid} type="button" onClick={() => toggle(k, p.uid)} className={`text-[11px] px-2 py-1 rounded-full border ${c.chain[k].includes(p.uid) ? 'bg-[#6d4cf0] text-white border-[#6d4cf0]' : 'bg-white text-slate-600 border-slate-200'}`}>{p.name}</button>)}
              </div>
            </div>
          ))}
          <div className="text-[11px] text-slate-400">Approvers need the payroll view permission to open the Payroll run page.</div>
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={c.sod.enabled} onChange={(e) => set(['sod', 'enabled'], e.target.checked)} /> Separation of duties: whoever calculates or changes a run, or edits salaries, cannot approve or release it</label>
        </fieldset>
      </Card>

      <Card title="Payroll calendar">
        <fieldset disabled={!isAdmin || busy} className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={c.calendar.enabled} onChange={(e) => set(['calendar', 'enabled'], e.target.checked)} /> Use a payroll calendar</label>
          <Field label="Input cut-off (day of next month)"><input type="number" min={1} max={28} className={`${input} w-24`} value={c.calendar.cutoffDay} onChange={(e) => set(['calendar', 'cutoffDay'], Number(e.target.value))} /></Field>
          <Field label="Salary day (next month)"><input type="number" min={1} max={28} className={`${input} w-24`} value={c.calendar.payDay} onChange={(e) => set(['calendar', 'payDay'], Number(e.target.value))} /></Field>
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={c.calendar.requireFreeze} onChange={(e) => set(['calendar', 'requireFreeze'], e.target.checked)} /> Inputs must be frozen before approval</label>
        </fieldset>
        <div className="text-[11px] text-slate-400 mt-2">The freeze covers payroll-side inputs (adjustments, attendance overrides). Attendance and leave records themselves are not blocked.</div>
      </Card>

      <Card title="Company details for this legal entity" subtitle="Registration numbers print on payslips; the bank account is the one salaries are paid from.">
        <fieldset disabled={!isAdmin || busy} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {([['pfRegNo', 'PF registration'], ['esiRegNo', 'ESI registration'], ['ptRegNo', 'PT registration'], ['lwfRegNo', 'LWF registration'], ['bankName', 'Bank'], ['bankAccount', 'Account number'], ['bankIfsc', 'IFSC'], ['branch', 'Branch']] as [string, string][]).map(([k, l]) => (
            <Field key={k} label={l}><input className={input} value={c.entity[k] || ''} onChange={(e) => set(['entity', k], e.target.value)} /></Field>
          ))}
        </fieldset>
        <div className="text-[11px] text-slate-400 mt-2">Each organisation in this portal is its own legal entity with its own payroll settings, runs and numbers. Create another organisation for a second entity.</div>
        {isAdmin && <button className={`${btnPrimary} mt-3`} disabled={busy} onClick={() => run(async () => { await payrollService.saveControls(c); await load(); }, 'Controls saved.')}>Save controls</button>}
      </Card>

      <Card title="Cost centres" subtitle="Share each person's cost between cost centres; the cost report adds them up.">
        <div className="space-y-1.5 mb-2">
          {centres.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${input} w-56`} value={x.name} disabled={!canManage} onChange={(e) => setCentres(centres.map((y, j) => (j === i ? { ...y, name: e.target.value, id: y.id } : y)))} />
              <label className="text-[11px] flex items-center gap-1"><input type="checkbox" disabled={!canManage} checked={x.active} onChange={(e) => setCentres(centres.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} /> active</label>
            </div>
          ))}
        </div>
        {canManage && <div className="flex gap-2">
          <button className={btnGhost} onClick={() => setCentres([...centres, { id: '', name: '', active: true }])}>Add cost centre</button>
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const r = await payrollService.saveCostCentres(centres); setCentres(r.items); }, 'Cost centres saved.')}>Save cost centres</button>
        </div>}
        <div className="border-t border-slate-100 mt-4 pt-3 space-y-2">
          <Field label="Split for"><select className={`${input} w-64`} value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Choose an employee</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name} ({p.empId})</option>)}</select></Field>
          {uid && <>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={input} value={r.costCentreId} disabled={!canManage} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, costCentreId: e.target.value } : x)))}>
                  <option value="">Cost centre</option>{centres.filter((x) => x.id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (off)'}</option>)}
                </select>
                <input className={`${input} w-20`} value={r.pct} disabled={!canManage} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} /> %
                {canManage && <button className="text-rose-600 text-xs font-bold" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            <div className={`text-xs font-semibold ${total === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>Total {total}%</div>
            {canManage && <div className="flex gap-2">
              <button className={btnGhost} onClick={() => setRows([...rows, { costCentreId: '', pct: '' }])}>Add row</button>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveCostAllocation(uid, rows.map((r) => ({ costCentreId: r.costCentreId, pct: Number(r.pct) }))); await load(); }, 'Split saved.')}>Save split</button>
            </div>}
          </>}
        </div>
      </Card>

      <Card title="Cost by cost centre" right={<div className="flex items-center gap-2">
        <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span className="text-xs font-bold w-32 text-center">{monthLabel(month)}</span><button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>}>
        {report && report.rows.length === 0 && <div className="text-xs text-slate-500">No payroll run for this month.</div>}
        {report && report.rows.length > 0 && (
          <table className="text-xs w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Cost centre</th><th className="p-1.5 text-right">People</th><th className="p-1.5 text-right">Gross</th><th className="p-1.5 text-right">Employer cost</th></tr></thead>
            <tbody>
              {report.rows.map((r: any) => <tr key={r.id} className="border-t border-slate-100"><td className="p-1.5 font-semibold">{r.name}</td><td className="p-1.5 text-right">{r.people}</td><td className="p-1.5 text-right tabular-nums">{inr(r.gross)}</td><td className="p-1.5 text-right tabular-nums">{inr(r.employerCost)}</td></tr>)}
              <tr className="border-t border-slate-300 font-bold"><td className="p-1.5">Total</td><td /><td className="p-1.5 text-right tabular-nums">{inr(report.totalGross)}</td><td className="p-1.5 text-right tabular-nums">{inr(report.total)}</td></tr>
            </tbody>
          </table>
        )}
        {report?.unallocated?.length > 0 && <div className="text-[11px] text-amber-700 mt-2">{report.unallocated.length} people have no split and are shown as "Not allocated".</div>}
      </Card>

      {uid && vers && (
        <Card title={`Salary history, ${vers.person.name}`} subtitle="Every change to this person's salary, with its effective date.">
          <table className="text-xs w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Effective from</th><th className="p-1.5 text-right">Monthly gross</th><th className="p-1.5 text-right">Annual CTC</th><th className="p-1.5">Source</th><th className="p-1.5">By</th></tr></thead>
            <tbody>{vers.versions.map((v: any, i: number) => <tr key={i} className="border-t border-slate-100"><td className="p-1.5">{v.effectiveFrom === '2000-01-01' ? 'From the start' : v.effectiveFrom}</td><td className="p-1.5 text-right tabular-nums">{inr(v.gross)}</td><td className="p-1.5 text-right tabular-nums">{inr(v.annualCtc)}</td><td className="p-1.5">{v.source.toLowerCase()}</td><td className="p-1.5">{v.by}</td></tr>)}</tbody>
          </table>
          <div className="text-[11px] text-slate-400 mt-2">Back-dated increments are applied through Revisions, which also pays the arrears for months already locked.</div>
        </Card>
      )}
    </div>
  );
};
