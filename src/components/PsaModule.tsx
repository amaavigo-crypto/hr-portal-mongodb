import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { hasPerm } from '../../shared/permissions';
import { downloadCsv } from '../services/leaveService';
import { inr } from '../services/payrollService';
import { psaService } from '../services/psaService';
import { workplaceService } from '../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from './leave/ui';

const ist = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
const mondayOf = (d: string) => { const t = Date.parse(d + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - dow * 86400_000).toISOString().slice(0, 10); };
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const Timesheet: React.FC = () => {
  const [ws, setWs] = useState(mondayOf(ist()));
  const [projects, setProjects] = useState<any[]>([]);
  const [sheet, setSheet] = useState<any | null>(null);
  const [grid, setGrid] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([psaService.myProjects(), psaService.sheet(ws)]);
    setProjects(p.items); setSheet(s.sheet);
    setGrid(Object.fromEntries((s.sheet.entries || []).map((e: any) => [`${e.projectId}|${e.date}`, String(e.hours)])));
  }, [ws]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const locked = sheet && !['DRAFT', 'REJECTED'].includes(sheet.status);
  const entries = () => Object.entries(grid).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ projectId: k.split('|')[0], date: k.split('|')[1], hours: Number(v) }));
  const dayTotal = (d: string) => projects.reduce((a, p) => a + Number(grid[`${p.id}|${d}`] || 0), 0);
  return (
    <div className="space-y-3">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title={`Week of ${ws}`} subtitle={sheet ? `Status: ${sheet.status.toLowerCase()}${sheet.decisionNote ? ` · ${sheet.decisionNote}` : ''}` : ''} right={<span className="flex gap-1"><button className={btnGhost} onClick={() => setWs(addDays(ws, -7))}>‹</button><button className={btnGhost} onClick={() => setWs(mondayOf(ist()))}>This week</button><button className={btnGhost} onClick={() => setWs(addDays(ws, 7))}>›</button></span>}>
        {projects.length === 0 ? <p className="text-sm text-slate-500">You are not on any project yet. Ask a project manager to add you.</p> : (
          <div className="overflow-x-auto"><table className="text-xs w-full">
            <thead className="text-slate-500"><tr><th className="text-left p-1.5">Project</th>{days.map((d, i) => <th key={d} className="p-1.5">{DOW[i]}<span className="block font-normal">{d.slice(8)}</span></th>)}</tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id} className="border-t border-slate-100"><td className="p-1.5 font-semibold">{p.name}<span className="block font-normal text-slate-500">{p.clientName}</span></td>
                {days.map((d) => <td key={d} className="p-1"><input type="number" step="0.25" min="0" max="24" disabled={!!locked} className={input + ' w-16 text-center'} value={grid[`${p.id}|${d}`] || ''} onChange={(e) => setGrid({ ...grid, [`${p.id}|${d}`]: e.target.value })} /></td>)}</tr>))}
              <tr className="border-t border-slate-200 font-bold"><td className="p-1.5">Total</td>{days.map((d) => <td key={d} className={`p-1.5 text-center ${dayTotal(d) > 24 ? 'text-rose-600' : ''}`}>{dayTotal(d) || ''}</td>)}</tr></tbody>
          </table></div>
        )}
        {!locked && projects.length > 0 && (
          <div className="mt-3 flex gap-2">
            <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await psaService.saveSheet(ws, entries()); await load(); })}>Save draft</button>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await psaService.saveSheet(ws, entries()); await psaService.submitSheet(ws); await load(); })}>Send for approval</button>
          </div>
        )}
      </Card>
    </div>
  );
};

const Queue: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();
  const load = useCallback(() => psaService.queue().then((r) => setItems(r.items)), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  return (
    <Card title="Timesheets to approve">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {items.length === 0 && <p className="text-sm text-slate-400">Nothing waiting.</p>}
      {items.map((s) => (
        <div key={s.id} className="border-t border-slate-100 first:border-0 py-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex-1 min-w-[12rem]"><b>{s.name}</b> · week of {s.weekStart} · {s.hours} h<span className="block text-slate-500">{s.byProject.map((p: any) => `${p.project} ${p.hours}h`).join(' · ')}</span></span>
          <input className={input + ' max-w-[14rem]'} placeholder="Note (needed to send back)" value={notes[s.id] || ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await psaService.decide(s.id, true, notes[s.id]); await load(); })}>Approve</button>
          <button className={btnDanger} disabled={busy || !(notes[s.id] || '').trim()} onClick={() => run(async () => { await psaService.decide(s.id, false, notes[s.id]); await load(); })}>Send back</button>
        </div>
      ))}
    </Card>
  );
};

const Projects: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [allocs, setAllocs] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [load, setLoad] = useState<any[]>([]);
  const [cl, setCl] = useState({ name: '', email: '', gstin: '' });
  const [pj, setPj] = useState<any>({ name: '', clientId: '', billing: 'TM', defaultRate: '', fixedFee: '', budgetHours: '' });
  const [al, setAl] = useState({ projectId: '', uid: '', hoursPerWeek: '', from: ist(), to: ist(90) });
  const { busy, note, run } = useRunner();
  const refresh = useCallback(async () => {
    const [c, p] = await Promise.all([psaService.clients().catch(() => ({ items: [] })), psaService.projects()]);
    setClients(c.items); setProjects(p.items);
    const [a, l] = await Promise.all([psaService.allocations().catch(() => ({ items: [] })), psaService.load().catch(() => ({ items: [] }))]);
    setAllocs(a.items); setLoad(l.items);
  }, []);
  useEffect(() => { refresh().catch(() => undefined); workplaceService.directory().then((r) => setPeople(r.items)).catch(() => undefined); }, [refresh]);
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {canManage && (
        <Card title="Add a client">
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <Field label="Name"><input className={input} value={cl.name} onChange={(e) => setCl({ ...cl, name: e.target.value })} /></Field>
            <Field label="Email"><input className={input} value={cl.email} onChange={(e) => setCl({ ...cl, email: e.target.value })} /></Field>
            <Field label="GSTIN"><input className={input} value={cl.gstin} onChange={(e) => setCl({ ...cl, gstin: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy || !cl.name.trim()} onClick={() => run(async () => { await psaService.saveClient(cl); setCl({ name: '', email: '', gstin: '' }); await refresh(); })}>Add</button>
          </div>
          <p className="text-xs text-slate-500 mt-2">{clients.map((c) => c.name).join(' · ')}</p>
        </Card>
      )}
      {canManage && (
        <Card title="Add a project">
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <Field label="Name"><input className={input} value={pj.name} onChange={(e) => setPj({ ...pj, name: e.target.value })} /></Field>
            <Field label="Client"><select className={input} value={pj.clientId} onChange={(e) => setPj({ ...pj, clientId: e.target.value })}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Billing"><select className={input} value={pj.billing} onChange={(e) => setPj({ ...pj, billing: e.target.value })}><option value="TM">Hourly (time & material)</option><option value="FIXED">Fixed fee</option></select></Field>
            {pj.billing === 'TM' ? <Field label="Rate per hour (₹)"><input type="number" className={input} value={pj.defaultRate} onChange={(e) => setPj({ ...pj, defaultRate: e.target.value })} /></Field> : <Field label="Fixed fee (₹)"><input type="number" className={input} value={pj.fixedFee} onChange={(e) => setPj({ ...pj, fixedFee: e.target.value })} /></Field>}
            <Field label="Budget hours"><input type="number" className={input} value={pj.budgetHours} onChange={(e) => setPj({ ...pj, budgetHours: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy || !pj.name.trim() || !pj.clientId} onClick={() => run(async () => { await psaService.saveProject(pj); setPj({ ...pj, name: '' }); await refresh(); })}>Add</button>
          </div>
        </Card>
      )}
      <Card title="Projects">
        {projects.map((p) => (
          <div key={p.id} className="border-t border-slate-100 first:border-0 py-2 text-xs flex flex-wrap justify-between gap-2">
            <span><b>{p.name}</b> <span className="text-slate-500">· {p.clientName}{p.billing ? ` · ${p.billing === 'FIXED' ? `fixed ${inr(p.fixedFee)}` : `${inr(p.defaultRate)}/h`}` : ''}{p.status === 'CLOSED' ? ' · closed' : ''}</span></span>
            {p.loggedHours !== undefined && <span className={p.budgetHours && p.loggedHours > p.budgetHours ? 'text-rose-600 font-bold' : 'text-slate-600'}>{p.loggedHours} h{p.budgetHours ? ` of ${p.budgetHours}` : ''}</span>}
          </div>))}
        {projects.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>}
      </Card>
      {canManage && (
        <Card title="Put someone on a project">
          <div className="grid md:grid-cols-6 gap-2 items-end">
            <Field label="Project"><select className={input} value={al.projectId} onChange={(e) => setAl({ ...al, projectId: e.target.value })}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Person"><select className={input} value={al.uid} onChange={(e) => setAl({ ...al, uid: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
            <Field label="Hours / week"><input type="number" className={input} value={al.hoursPerWeek} onChange={(e) => setAl({ ...al, hoursPerWeek: e.target.value })} /></Field>
            <Field label="From"><input type="date" className={input} value={al.from} onChange={(e) => setAl({ ...al, from: e.target.value })} /></Field>
            <Field label="To"><input type="date" className={input} value={al.to} onChange={(e) => setAl({ ...al, to: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy || !al.projectId || !al.uid} onClick={() => run(async () => { await psaService.saveAllocation({ ...al, hoursPerWeek: Number(al.hoursPerWeek) }); await refresh(); })}>Add</button>
          </div>
        </Card>
      )}
      {allocs.length > 0 && (
        <Card title="Allocation" subtitle="Planned hours this week against 40.">
          <p className="text-xs mb-2">{load.map((l) => <span key={l.uid} className={`inline-block mr-3 ${l.over ? 'text-rose-600 font-bold' : ''}`}>{l.name}: {l.planned}h</span>)}</p>
          {allocs.map((a) => <div key={a.id} className="border-t border-slate-100 py-1.5 text-xs flex justify-between"><span><b>{a.name}</b> · {a.projectName} · {a.hoursPerWeek} h/week · {a.from} to {a.to}</span>{canManage && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await psaService.deleteAllocation(a.id); await refresh(); })}>Remove</button>}</div>)}
        </Card>
      )}
    </div>
  );
};

const Billing: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [clients, setClients] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [util, setUtil] = useState<any[]>([]);
  const [f, setF] = useState({ clientId: '', from: ist(-30), to: ist(), taxPct: '18' });
  const [prev, setPrev] = useState<any | null>(null);
  const [fixed, setFixed] = useState<Record<string, string>>({});
  const [view, setView] = useState<any | null>(null);
  const { busy, note, run } = useRunner();
  const refresh = useCallback(async () => {
    const [c, i, u] = await Promise.all([psaService.clients(), psaService.invoices(), psaService.utilisation(ist(-30), ist())]);
    setClients(c.items); setInvoices(i.items); setUtil(u.items);
  }, []);
  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);
  const status = (id: string, s: string) => run(async () => { await psaService.invoiceStatus(id, s); setView(null); await refresh(); });
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {canManage && (
        <Card title="New invoice" subtitle="Approved time that has not been billed yet.">
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <Field label="Client"><select className={input} value={f.clientId} onChange={(e) => { setF({ ...f, clientId: e.target.value }); setPrev(null); }}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Weeks from"><input type="date" className={input} value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPrev(null); }} /></Field>
            <Field label="to"><input type="date" className={input} value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPrev(null); }} /></Field>
            <Field label="Tax %"><input type="number" className={input} value={f.taxPct} onChange={(e) => setF({ ...f, taxPct: e.target.value })} /></Field>
            <button className={btnGhost} disabled={busy || !f.clientId} onClick={() => run(async () => setPrev(await psaService.billable(f.clientId, f.from, f.to)))}>Preview</button>
          </div>
          {prev && (
            <div className="mt-3 text-xs">
              {prev.lines.map((l: any, i: number) => <div key={i} className="flex justify-between border-t border-slate-100 py-1"><span>{l.projectName} · {l.name} · {l.hours} h × {inr(l.rate)}</span><b>{inr(l.amount)}</b></div>)}
              {prev.fixed.filter((x: any) => x.remaining > 0).map((x: any) => <div key={x.projectId} className="flex items-center justify-between border-t border-slate-100 py-1"><span>{x.name} · fixed fee, {inr(x.remaining)} left to bill</span><input type="number" className={input + ' w-28'} placeholder="Amount" value={fixed[x.projectId] || ''} onChange={(e) => setFixed({ ...fixed, [x.projectId]: e.target.value })} /></div>)}
              {!prev.lines.length && !Object.values(fixed).some(Boolean) && <p className="text-slate-400">Nothing to bill yet.</p>}
              <div className="mt-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await psaService.createInvoice({ ...f, taxPct: Number(f.taxPct || 0), fixed: Object.entries(fixed).filter(([, v]) => Number(v) > 0).map(([projectId, amount]) => ({ projectId, amount: Number(amount) })) }); setPrev(null); setFixed({}); await refresh(); })}>Create invoice</button></div>
            </div>
          )}
        </Card>
      )}
      {view ? (
        <Card title={`${view.number} · ${view.clientName}`} subtitle={`${view.status.toLowerCase()} · issued ${view.issueDate}, due ${view.dueDate}`} right={<button className={btnGhost} onClick={() => setView(null)}>Close</button>}>
          {view.lines.map((l: any, i: number) => <div key={i} className="flex justify-between border-t border-slate-100 py-1 text-xs"><span>{l.projectName} · {l.name}{l.hours ? ` · ${l.hours} h × ${inr(l.rate)}` : ''}</span><b>{inr(l.amount)}</b></div>)}
          <div className="text-right text-xs mt-2">Subtotal {inr(view.subtotal)} · Tax {view.taxPct}% {inr(view.tax)} · <b>Total {inr(view.total)}</b></div>
          <div className="mt-3 flex gap-2">
            <button className={btnGhost} onClick={() => downloadCsv(`${view.number}.csv`, [['Project', 'Person', 'Hours', 'Rate', 'Amount'], ...view.lines.map((l: any) => [l.projectName, l.name, l.hours, l.rate, l.amount]), ['', '', '', 'Tax', view.tax], ['', '', '', 'Total', view.total]])}>Download CSV</button>
            {canManage && view.status === 'DRAFT' && <button className={btnPrimary} disabled={busy} onClick={() => status(view.id, 'SENT')}>Mark sent</button>}
            {canManage && view.status === 'SENT' && <button className={btnPrimary} disabled={busy} onClick={() => status(view.id, 'PAID')}>Mark paid</button>}
            {canManage && ['DRAFT', 'SENT'].includes(view.status) && <button className={btnDanger} disabled={busy} onClick={() => status(view.id, 'VOID')}>Void</button>}
          </div>
        </Card>
      ) : (
        <Card title="Invoices">
          {invoices.map((i) => <button key={i.id} className="w-full text-left flex justify-between border-t border-slate-100 first:border-0 py-2 text-xs" onClick={() => run(async () => setView((await psaService.invoice(i.id)).invoice))}><span><b>{i.number}</b> · {i.clientName} · {i.issueDate}</span><span>{inr(i.total)} · {i.status.toLowerCase()}</span></button>)}
          {invoices.length === 0 && <p className="text-sm text-slate-400">No invoices yet.</p>}
        </Card>
      )}
      <Card title="Utilisation, last 30 days" subtitle="Share of logged hours on billable projects.">
        {util.map((u) => <div key={u.uid} className="flex justify-between border-t border-slate-100 first:border-0 py-1 text-xs"><span>{u.name}</span><span>{u.billable} billable · {u.other} other · <b>{u.utilisation}%</b></span></div>)}
        {util.length === 0 && <p className="text-sm text-slate-400">No time logged yet.</p>}
      </Card>
    </div>
  );
};

const KEY = 'amaavigo_psa_tab';
export const PsaModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const can = (p: string) => !!currentUser.isCompanyAdmin || hasPerm(currentUser.perms || [], p);
  const manage = can('psa.manage'), view = manage || can('psa.view');
  const tabs: [string, string][] = [['time', 'My timesheet'], ['queue', 'Approvals'], ['projects', 'Projects'], ...(view ? [['billing', 'Billing & utilisation'] as [string, string]] : [])];
  const [tab, setTab] = useState(() => { try { const v = localStorage.getItem(KEY) || ''; return tabs.some(([k]) => k === v) ? v : 'time'; } catch { return 'time'; } });
  const pick = (t: string) => { setTab(t); try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ } };
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div><h1 className="text-3xl font-bold tracking-tight text-slate-950">Projects</h1><p className="mt-1 text-sm text-slate-600">Clients, projects, timesheets, and billing.</p></div>
        <div className="flex gap-1.5 overflow-x-auto" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => pick(k)} className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold border ${tab === k ? 'bg-[#6d4cf0] text-white border-transparent' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{l}</button>)}</div>
        {tab === 'time' && <Timesheet />}
        {tab === 'queue' && <Queue />}
        {tab === 'projects' && <Projects canManage={manage} />}
        {tab === 'billing' && view && <Billing canManage={manage} />}
      </div>
    </div>
  );
};
