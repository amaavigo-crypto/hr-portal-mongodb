import React, { useCallback, useEffect, useState } from 'react';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const TYPES: [string, string][] = [['TEXT', 'Text'], ['NUMBER', 'Number'], ['DATE', 'Date'], ['SELECT', 'Pick one'], ['BOOLEAN', 'Yes / no']];

/** One input per field, shown for the person it belongs to. */
const ValueInputs: React.FC<{ defs: any[]; values: Record<string, any>; onChange: (v: Record<string, any>) => void; editable: (d: any) => boolean }> = ({ defs, values, onChange, editable }) => {
  const sections = Array.from(new Set(defs.map((d) => d.section)));
  return (
    <div className="space-y-4">
      {sections.map((sec) => (
        <div key={sec}><p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">{sec}</p>
          <div className="grid md:grid-cols-3 gap-2">
            {defs.filter((d) => d.section === sec).map((d) => {
              const v = values[d.key] ?? '', dis = !editable(d), set = (x: any) => onChange({ ...values, [d.key]: x });
              return (
                <Field key={d.key} label={`${d.label}${d.required ? ' *' : ''}`}>
                  {d.type === 'SELECT' ? <select className={input} disabled={dis} value={v} onChange={(e) => set(e.target.value)}><option value="">–</option>{d.options.map((o: string) => <option key={o}>{o}</option>)}</select>
                    : d.type === 'BOOLEAN' ? <select className={input} disabled={dis} value={v === '' ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? '' : e.target.value === 'true')}><option value="">–</option><option value="true">Yes</option><option value="false">No</option></select>
                    : <input className={input} disabled={dis} type={d.type === 'NUMBER' ? 'number' : d.type === 'DATE' ? 'date' : 'text'} value={v} onChange={(e) => set(e.target.value)} />}
                </Field>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export const CustomFields: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [defs, setDefs] = useState<any[]>([]);
  const [edit, setEdit] = useState<any[] | null>(null);
  const [mine, setMine] = useState<Record<string, any>>({});
  const [people, setPeople] = useState<any[]>([]);
  const [uid, setUid] = useState('');
  const [theirs, setTheirs] = useState<{ defs: any[]; values: Record<string, any>; missing: string[] } | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(async () => { const r = await workplaceService.fields(); setDefs(r.defs); setMine(r.values || {}); }, []);
  useEffect(() => { load().catch(() => undefined); if (canManage) workplaceService.directory().then((r) => setPeople(r.items)).catch(() => undefined); }, [load, canManage]);
  const upd = (i: number, p: any) => setEdit(edit!.map((d, j) => (j === i ? { ...d, ...p } : d)));

  return (
    <div className="space-y-4 max-w-4xl">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {defs.some((d) => d.selfView) || canManage ? (
        <Card title="My additional details" subtitle="Fields marked read-only can only be changed by HR.">
          {defs.length === 0 ? <p className="text-sm text-slate-400">No extra details to fill in.</p> : (
            <>
              <ValueInputs defs={defs.filter((d) => d.selfView)} values={mine} onChange={setMine} editable={(d) => d.selfEdit} />
              <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.saveFieldValues(undefined, Object.fromEntries(defs.filter((d) => d.selfEdit).map((d) => [d.key, mine[d.key] ?? '']))); await load(); })}>Save</button></div>
            </>
          )}
        </Card>
      ) : <p className="text-sm text-slate-500">Nothing to show here.</p>}

      {canManage && (
        <>
          <Card title="Fields on employee profiles" right={!edit && <button className={btnPrimary} onClick={() => setEdit(defs.map((d) => ({ ...d })))}>Edit fields</button>}>
            {!edit && <p className="text-xs text-slate-600">{defs.length ? defs.map((d) => `${d.label} (${d.type.toLowerCase()})`).join(' · ') : 'No fields yet.'}</p>}
            {edit && (
              <div className="space-y-2">
                {edit.map((d, i) => (
                  <div key={i} className="grid md:grid-cols-[1fr_8rem_9rem_1fr_auto] gap-2 items-end border border-slate-200 rounded-xl p-2">
                    <Field label="Label"><input className={input} value={d.label} onChange={(e) => upd(i, { label: e.target.value })} /></Field>
                    <Field label="Type"><select className={input} value={d.type} onChange={(e) => upd(i, { type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                    <Field label="Section"><input className={input} value={d.section || ''} placeholder="Additional details" onChange={(e) => upd(i, { section: e.target.value })} /></Field>
                    {d.type === 'SELECT' ? <Field label="Options (one per line)"><textarea className={input + ' h-14'} value={(d.options || []).join('\n')} onChange={(e) => upd(i, { options: e.target.value.split('\n') })} /></Field> : <div />}
                    <button className={btnDanger} onClick={() => setEdit(edit.filter((_, j) => j !== i))}>×</button>
                    <div className="md:col-span-5 flex gap-4 text-xs"><label><input type="checkbox" checked={!!d.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Required</label><label><input type="checkbox" checked={!!d.selfView} onChange={(e) => upd(i, { selfView: e.target.checked })} /> Employee can see</label><label><input type="checkbox" checked={!!d.selfEdit} onChange={(e) => upd(i, { selfEdit: e.target.checked })} /> Employee can edit</label></div>
                  </div>
                ))}
                <div className="flex gap-2"><button className={btnGhost} onClick={() => setEdit([...edit, { label: '', type: 'TEXT', section: '', required: false, selfView: false, selfEdit: false }])}>Add field</button>
                  <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.saveFields(edit); setEdit(null); await load(); })}>Save</button><button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button></div>
              </div>
            )}
          </Card>

          <Card title="Fill in for an employee">
            <select className={input + ' max-w-sm'} value={uid} onChange={(e) => { setUid(e.target.value); setTheirs(null); if (e.target.value) workplaceService.fieldValues(e.target.value).then(setTheirs); }}><option value="">Choose a person…</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select>
            {theirs && (
              <div className="mt-3">
                {theirs.missing.length > 0 && <Notice tone="warn">Still empty: {theirs.missing.join(', ')}</Notice>}
                <div className="mt-2"><ValueInputs defs={theirs.defs} values={theirs.values} onChange={(v) => setTheirs({ ...theirs, values: v })} editable={() => true} /></div>
                <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.saveFieldValues(uid, Object.fromEntries(theirs.defs.map((d) => [d.key, theirs.values[d.key] ?? '']))); setTheirs(await workplaceService.fieldValues(uid)); })}>Save</button></div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
