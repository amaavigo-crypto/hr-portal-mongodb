import React, { useCallback, useEffect, useState } from 'react';
import { csvToObjects } from '../../../shared/csv';
import { inr } from '../../services/payrollService';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const STATUS = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'];
const label = (s: string) => s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const blank = { tag: '', name: '', category: '', serial: '', vendor: '', purchaseDate: '', cost: '', salvage: '', usefulLifeMonths: '', warrantyUntil: '', notes: '' };

/** What is assigned to me, with a button to confirm I received it. */
export const MyAssets: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const { busy, run } = useRunner();
  const load = useCallback(() => workplaceService.myAssets().then((r) => setItems(r.items)), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (!items.length) return null;
  return (
    <Card title="Assets assigned to you">
      {items.map((a) => (
        <div key={a.id} className="flex items-center justify-between py-2 border-t border-slate-100 first:border-0 text-sm">
          <span><b>{a.name}</b> <span className="text-slate-500">· {a.tag}{a.serial ? ` · ${a.serial}` : ''}</span></span>
          {a.acknowledgedAt ? <span className="text-xs text-emerald-700 font-bold">Received</span> : <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.acknowledgeAsset(a.id); await load(); })}>I received it</button>}
        </div>
      ))}
    </Card>
  );
};

export const Assets: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [form, setForm] = useState<any | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [who, setWho] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([workplaceService.assets(status, q), workplaceService.assetSummary()]);
    setItems(l.items); setSummary(s);
  }, [status, q]);
  useEffect(() => { if (canManage) load().catch(() => undefined); }, [load, canManage]);
  useEffect(() => { workplaceService.directory().then((r) => setPeople(r.items)).catch(() => undefined); }, []);

  const act = (id: string, action: string, extra: any = {}) => run(async () => { await workplaceService.assetAct({ id, action, ...extra }); await load(); if (open?.id === id) setOpen((await workplaceService.asset(id)).asset); });

  if (!canManage) return <div className="space-y-4 max-w-3xl"><MyAssets /><p className="text-sm text-slate-500">Assets assigned to you appear above.</p></div>;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <MyAssets />
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
          {[['Total', summary.total], ...STATUS.map((s) => [label(s), summary.byStatus[s] || 0]), ['Book value', inr(summary.bookValue)], ['Warranty ending soon', summary.warrantyExpiring], ['Not yet acknowledged', summary.unacknowledged]].slice(0, 10).map(([k, v]: any) => (
            <div key={k} className="bg-white border border-slate-200 rounded-xl py-2"><div className="text-lg font-bold text-slate-900">{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>
          ))}
        </div>
      )}
      <Card title="Asset register" right={<div className="flex gap-2"><button className={btnPrimary} onClick={() => setForm({ ...blank })}>Add asset</button></div>}>
        <div className="flex gap-2 mb-3">
          <input className={input + ' max-w-xs'} placeholder="Search tag, name, serial, person" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={input + ' max-w-[10rem]'} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        </div>
        <table className="text-xs w-full">
          <thead className="text-left text-slate-500"><tr><th className="p-1.5">Tag</th><th className="p-1.5">Name</th><th className="p-1.5">Status</th><th className="p-1.5">With</th><th className="p-1.5 text-right">Book value</th><th className="p-1.5">Warranty</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => workplaceService.asset(a.id).then((r) => { setOpen(r.asset); setWho(''); })}>
                <td className="p-1.5 font-semibold">{a.tag}</td><td className="p-1.5">{a.name}<span className="text-slate-400"> · {a.category}</span></td><td className="p-1.5">{label(a.status)}</td>
                <td className="p-1.5">{a.assignedToName}{a.assignedToName && !a.acknowledgedAt ? ' (not confirmed)' : ''}</td><td className="p-1.5 text-right tabular-nums">{inr(a.bookValue)}</td>
                <td className={`p-1.5 ${a.warranty === 'EXPIRED' ? 'text-rose-600' : a.warranty === 'EXPIRING' ? 'text-amber-600' : 'text-slate-500'}`}>{a.warrantyUntil || '–'}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-400">No assets yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {open && (
        <Card title={`${open.name} · ${open.tag}`} right={<div className="flex gap-2"><button className={btnGhost} onClick={() => setForm({ ...open, cost: String(open.cost), salvage: String(open.salvage), usefulLifeMonths: String(open.usefulLifeMonths) })}>Edit</button><button className={btnGhost} onClick={() => setOpen(null)}>Close</button></div>}>
          <p className="text-xs text-slate-600 mb-2">{label(open.status)}{open.assignedToName ? ` · with ${open.assignedToName}` : ''} · book value {inr(open.bookValue)}</p>
          <div className="flex flex-wrap gap-2 items-center mb-3">
            {open.status === 'IN_STOCK' && <><select className={input + ' max-w-[14rem]'} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Assign to…</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select><button className={btnPrimary} disabled={busy || !who} onClick={() => act(open.id, 'assign', { uid: who })}>Assign</button></>}
            {open.status === 'ASSIGNED' && <><button className={btnPrimary} disabled={busy} onClick={() => act(open.id, 'return', { condition: 'GOOD' })}>Returned, good</button><button className={btnGhost} disabled={busy} onClick={() => act(open.id, 'return', { condition: 'DAMAGED' })}>Returned, damaged</button></>}
            {['IN_STOCK', 'ASSIGNED'].includes(open.status) && <button className={btnGhost} disabled={busy} onClick={() => act(open.id, 'send_repair')}>Send for repair</button>}
            {open.status === 'IN_REPAIR' && <button className={btnPrimary} disabled={busy} onClick={() => act(open.id, 'repair_done')}>Repair done</button>}
            {['IN_STOCK', 'IN_REPAIR'].includes(open.status) && <button className={btnGhost} disabled={busy} onClick={() => window.confirm('Retire this asset? This is final.') && act(open.id, 'retire')}>Retire</button>}
            {['IN_STOCK', 'ASSIGNED', 'IN_REPAIR'].includes(open.status) && <button className={btnGhost} disabled={busy} onClick={() => act(open.id, 'lost')}>Mark lost</button>}
            {open.status === 'LOST' && <button className={btnPrimary} disabled={busy} onClick={() => act(open.id, 'found')}>Found</button>}
          </div>
          <ul className="text-xs text-slate-600 space-y-1">{[...open.history].reverse().map((h: any, i: number) => <li key={i}>{h.at.slice(0, 16).replace('T', ' ')} · {h.action.replace('_', ' ').toLowerCase()}{h.to ? ` → ${h.to}` : ''}{h.from ? ` from ${h.from}` : ''}{h.condition ? ` (${h.condition.toLowerCase()})` : ''} · {h.by}{h.note ? ` · ${h.note}` : ''}</li>)}</ul>
        </Card>
      )}

      {form && (
        <Card title={form.id ? 'Edit asset' : 'Add asset'} right={<button className={btnGhost} onClick={() => setForm(null)}>Cancel</button>}>
          <div className="grid md:grid-cols-4 gap-2">
            {([['tag', 'Tag'], ['name', 'Name'], ['category', 'Category'], ['serial', 'Serial no.'], ['vendor', 'Vendor'], ['purchaseDate', 'Purchase date', 'date'], ['warrantyUntil', 'Warranty until', 'date'], ['cost', 'Cost (₹)', 'number'], ['salvage', 'Salvage value (₹)', 'number'], ['usefulLifeMonths', 'Useful life (months)', 'number'], ['notes', 'Notes']] as any[]).map(([k, l, t]) => (
              <Field key={k} label={l}><input type={t || 'text'} className={input} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.saveAsset({ ...form, cost: Number(form.cost || 0), salvage: Number(form.salvage || 0), usefulLifeMonths: Number(form.usefulLifeMonths || 0) }); setForm(null); setOpen(null); await load(); })}>Save</button></div>
        </Card>
      )}

      <Card title="Import from CSV" subtitle="Columns: tag, name, category, serial, vendor, purchaseDate, cost, salvage, usefulLifeMonths, warrantyUntil (dates as YYYY-MM-DD).">
        <textarea className={input + ' h-24 font-mono text-xs'} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'tag,name,category,cost\nLAP-0001,Dell Latitude,Laptops,85000'} />
        <div className="mt-2"><button className={btnGhost} disabled={busy || !csv.trim()} onClick={() => run(async () => { setResult(await workplaceService.importAssets(csvToObjects(csv))); await load(); })}>Import</button></div>
        {result && <div className="mt-2 text-xs"><p>{result.added} added.</p>{result.problems.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4">{result.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></Notice>}</div>}
      </Card>
    </div>
  );
};
