import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { hrbpService } from '../../services/hrbpService';

/** Skill profiles used by the project planner: each person fills theirs, their manager (or HR) confirms. Server: api/_lib/projectPlannerApi.ts. */

type Skill = { name: string; level: 1 | 2 | 3 };
const LEVELS: [1 | 2 | 3, string][] = [[1, 'Learning'], [2, 'Good'], [3, 'Expert']];
const STATUS: Record<string, [string, string]> = {
  NONE: ['Not filled in', 'bg-slate-100 text-slate-700'], SUBMITTED: ['Waiting for confirmation', 'bg-brand-50 text-brand-800'], CONFIRMED: ['Confirmed', 'bg-emerald-50 text-emerald-800'],
};

const SkillEditor: React.FC<{ skills: Skill[]; onChange: (s: Skill[]) => void }> = ({ skills, onChange }) => {
  const [text, setText] = useState('');
  const add = () => {
    const names = text.split(',').map((s) => s.trim()).filter(Boolean);
    const have = new Set(skills.map((s) => s.name.toLowerCase()));
    onChange([...skills, ...names.filter((n) => !have.has(n.toLowerCase())).map((name) => ({ name: name.slice(0, 40), level: 2 as const }))].slice(0, 30));
    setText('');
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 && <p className="text-sm text-slate-600">No skills yet.</p>}
        {skills.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white py-1 pl-3 pr-1">
            <span className="text-sm font-semibold text-slate-900">{s.name}</span>
            <select aria-label={`Level for ${s.name}`} value={s.level} onChange={(e) => onChange(skills.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) as 1 | 2 | 3 } : x)))} className="rounded-lg border-0 bg-slate-50 py-1 pl-2 pr-6 text-xs text-slate-700 focus:ring-2 focus:ring-brand-300">
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" aria-label={`Remove ${s.name}`} onClick={() => onChange(skills.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Add skills, separated by commas (e.g. React, Figma, Sales)" aria-label="Add skills"
          className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-[#4C3EB0] focus:outline-none focus:ring-2 focus:ring-[#6050D0]/25" />
        <button type="button" onClick={add} disabled={!text.trim()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"><Plus className="h-4 w-4" /> Add</button>
      </div>
    </div>
  );
};

export const MySkills: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => hrbpService.get('skill-my').then((r) => { setData(r); setSkills(r.skills || []); }).catch((e) => setNote({ ok: false, text: e.message }));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setBusy(true); setNote(null);
    try { const r = await hrbpService.post('skill-save', { skills }); setNote({ ok: true, text: r.message }); await load(); } catch (e: any) { setNote({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  if (!data) return note ? <p className="text-sm text-rose-700">{note.text}</p> : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">My skills</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Used to match people to projects. {data.managerName ? `${data.managerName} confirms them.` : 'HR confirms them.'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[data.status]?.[1]}`}>{STATUS[data.status]?.[0]}</span>
      </div>
      {data.suggested && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">These are suggestions from your job title and certificates. Check them, add your own, and save.</div>}
      <SkillEditor skills={skills} onChange={setSkills} />
      {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</p>}
      <button type="button" onClick={save} disabled={busy || skills.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-[#4C3EB0] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#3F3393] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save my skills</button>
    </section>
  );
};

export const TeamSkills: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [edit, setEdit] = useState<Skill[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => hrbpService.get('skill-team').then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const confirm = async (uid: string) => {
    setBusy(true); setError('');
    try { await hrbpService.post('skill-confirm', { uid, skills: edit }); setOpen(''); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  if (!data) return error ? <p className="text-sm text-rose-700">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Team skills</h2>
        <p className="mt-1 text-sm text-slate-600">{data.scope === 'company' ? 'Everyone in the company (you are an HRBP manager).' : 'The people who report to you.'} Confirmed skills count fully when matching people to projects. {data.waiting ? `${data.waiting} waiting for you.` : ''}</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {data.items.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Nobody reports to you, so there is nothing to confirm.</div>}
      <div className="space-y-2">
        {data.items.map((p: any) => (
          <div key={p.uid} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{p.name}</p><p className="text-xs text-slate-600">{[p.title, p.department].filter(Boolean).join(' · ') || 'No title'}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[p.status]?.[1]}`}>{p.source === 'suggested' ? 'Guessed from title' : STATUS[p.status]?.[0]}</span>
              <button type="button" onClick={() => { setOpen(open === p.uid ? '' : p.uid); setEdit(p.skills); }} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">{open === p.uid ? 'Close' : p.status === 'SUBMITTED' ? 'Review' : 'Edit'}</button>
            </div>
            {open !== p.uid && <div className="mt-3 flex flex-wrap gap-1.5">{p.skills.map((s: Skill) => <span key={s.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{s.name} · {LEVELS.find(([v]) => v === s.level)?.[1]}</span>)}</div>}
            {open === p.uid && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <SkillEditor skills={edit} onChange={setEdit} />
                <button type="button" onClick={() => confirm(p.uid)} disabled={busy || edit.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-[#4C3EB0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3F3393] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm these skills</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
