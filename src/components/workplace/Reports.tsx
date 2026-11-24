import React, { useCallback, useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const OPS: [string, string][] = [['eq', 'is'], ['neq', 'is not'], ['contains', 'contains'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['empty', 'is blank'], ['notempty', 'is not blank']];
const AGGS: [string, string][] = [['count', 'Count'], ['sum', 'Total'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest']];
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() + 5.5 * 3600_000 - 30 * 86400_000).toISOString().slice(0, 10);

export const Reports: React.FC<{ canBuild: boolean }> = ({ canBuild }) => {
  const [sets, setSets] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [def, setDef] = useState<any>({ dataset: '', columns: [], filters: [], group: null, sort: null });
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [out, setOut] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([workplaceService.reportDatasets(), workplaceService.reports()]);
    setSets(d.items); setSaved(s.items);
    setDef((cur: any) => (cur.dataset || !d.items.length ? cur : { ...cur, dataset: d.items[0].key }));
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const ds = sets.find((s) => s.key === def.dataset);
  const fields: any[] = ds?.fields || [];
  const numeric = fields.filter((f) => f.kind === 'number');
  const payload = () => ({ ...def, group: def.group?.by ? def.group : undefined, sort: def.sort?.field ? def.sort : undefined });
  const exec = () => run(async () => setOut(await workplaceService.reportRun({ def: payload(), from, to })));

  if (!sets.length) return <p className="text-sm text-slate-500">You do not have access to any report data yet.</p>;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Report" subtitle="Pick a dataset, the columns, and optional filters. Results never include more than your permissions allow.">
        <div className="grid md:grid-cols-4 gap-2">
          <Field label="Data"><select className={input} value={def.dataset} onChange={(e) => { setDef({ dataset: e.target.value, columns: [], filters: [], group: null, sort: null }); setOut(null); setId(''); }}>{sets.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          {ds?.ranged && <><Field label="From"><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        </div>
        <div className="mt-3"><p className="text-xs font-semibold text-slate-600 mb-1">Columns</p>
          <div className="flex flex-wrap gap-1.5">{fields.map((f) => { const on = def.columns.includes(f.key); return <button key={f.key} className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-violet-100 border-violet-300 font-bold' : 'bg-white border-slate-200'}`} onClick={() => setDef({ ...def, columns: on ? def.columns.filter((c: string) => c !== f.key) : [...def.columns, f.key] })}>{f.label}</button>; })}</div></div>
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold text-slate-600">Filters</p>
          {def.filters.map((f: any, i: number) => (
            <div key={i} className="flex gap-2 items-center">
              <select className={input + ' max-w-[11rem]'} value={f.field} onChange={(e) => setDef({ ...def, filters: def.filters.map((x: any, j: number) => (j === i ? { ...x, field: e.target.value } : x)) })}>{fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
              <select className={input + ' max-w-[9rem]'} value={f.op} onChange={(e) => setDef({ ...def, filters: def.filters.map((x: any, j: number) => (j === i ? { ...x, op: e.target.value } : x)) })}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {!['empty', 'notempty'].includes(f.op) && <input className={input + ' max-w-[12rem]'} value={f.value} onChange={(e) => setDef({ ...def, filters: def.filters.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
              <button className={btnDanger} onClick={() => setDef({ ...def, filters: def.filters.filter((_: any, j: number) => j !== i) })}>×</button>
            </div>
          ))}
          <button className={btnGhost} onClick={() => setDef({ ...def, filters: [...def.filters, { field: fields[0]?.key, op: 'eq', value: '' }] })}>Add filter</button>
        </div>
        <div className="mt-3 grid md:grid-cols-4 gap-2 items-end">
          <Field label="Group by (optional)"><select className={input} value={def.group?.by || ''} onChange={(e) => setDef({ ...def, group: e.target.value ? { by: e.target.value, agg: def.group?.agg || 'count', field: def.group?.field } : null })}><option value="">No grouping</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
          {def.group?.by && <Field label="Show"><select className={input} value={def.group.agg} onChange={(e) => setDef({ ...def, group: { ...def.group, agg: e.target.value } })}>{AGGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
          {def.group?.by && def.group.agg !== 'count' && <Field label="Of"><select className={input} value={def.group.field || ''} onChange={(e) => setDef({ ...def, group: { ...def.group, field: e.target.value } })}><option value="">Choose…</option>{numeric.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>}
          {!def.group?.by && <Field label="Sort by"><select className={input} value={def.sort?.field || ''} onChange={(e) => setDef({ ...def, sort: e.target.value ? { field: e.target.value, dir: def.sort?.dir || 'asc' } : null })}><option value="">Default</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>}
          {!def.group?.by && def.sort?.field && <Field label="Order"><select className={input} value={def.sort.dir} onChange={(e) => setDef({ ...def, sort: { ...def.sort, dir: e.target.value } })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></Field>}
        </div>
        <div className="mt-3 flex gap-2"><button className={btnPrimary} disabled={busy} onClick={exec}>Run report</button>
          {out && <button className={btnGhost} onClick={() => downloadCsv('report.csv', [out.columns.map((c: any) => c.label), ...out.rows.map((r: any) => out.columns.map((c: any) => r[c.key]))])}>Download CSV</button>}</div>
      </Card>

      {out && (
        <Card title="Result" subtitle={`${out.rows.length} rows${out.truncated ? ` (showing the first ${out.rows.length} of ${out.total})` : ''}`}>
          <div className="overflow-x-auto"><table className="text-xs w-full">
            <thead className="text-left text-slate-500"><tr>{out.columns.map((c: any) => <th key={c.key} className="p-1.5">{c.label}</th>)}</tr></thead>
            <tbody>{out.rows.slice(0, 500).map((r: any, i: number) => <tr key={i} className="border-t border-slate-100">{out.columns.map((c: any) => <td key={c.key} className={`p-1.5 ${c.kind === 'number' ? 'text-right tabular-nums' : ''}`}>{r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}</td>)}</tr>)}</tbody>
          </table></div>
          {out.rows.length > 500 && <p className="text-[11px] text-slate-400 mt-2">Showing 500 rows here. Download the CSV for all of them.</p>}
        </Card>
      )}

      <Card title="Saved reports">
        {canBuild && <div className="flex gap-2 items-end mb-3"><Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <label className="text-xs pb-2"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone who can open this data</label>
          <button className={btnPrimary} disabled={busy || !name.trim()} onClick={() => run(async () => { await workplaceService.saveReport({ id: id || undefined, name, shared, def: payload() }); setName(''); setId(''); await load(); })}>{id ? 'Update' : 'Save'} this report</button></div>}
        {saved.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t border-slate-100 py-2 text-xs">
            <span><b>{r.name}</b> <span className="text-slate-500">· {r.def.dataset}{r.shared ? ' · shared' : ''} · {r.createdByName}</span></span>
            <span className="flex gap-1">
              <button className={btnGhost} onClick={() => { setDef({ ...r.def, group: r.def.group || null, sort: r.def.sort || null }); setId(r.mine ? r.id : ''); setName(r.mine ? r.name : ''); setShared(r.shared); setOut(null); }}>Open</button>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { setDef({ ...r.def, group: r.def.group || null, sort: r.def.sort || null }); setOut(await workplaceService.reportRun({ id: r.id, from, to })); })}>Run</button>
              {canBuild && r.mine && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await workplaceService.deleteReport(r.id); await load(); })}>Delete</button>}
            </span>
          </div>
        ))}
        {saved.length === 0 && <p className="text-sm text-slate-400">Nothing saved yet.</p>}
      </Card>
    </div>
  );
};
