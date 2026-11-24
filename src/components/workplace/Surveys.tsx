import React, { useCallback, useEffect, useState } from 'react';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const TYPES = [['RATING', 'Rating 1–5'], ['NPS', 'Recommend 0–10'], ['CHOICE', 'Pick one'], ['MULTI', 'Pick several'], ['TEXT', 'Free text']];
const blank = () => ({ title: '', description: '', anonymous: true, closesAt: '', questions: [{ type: 'RATING', text: '', required: true, options: ['', ''] }] as any[] });

const Answer: React.FC<{ id: string; onDone: () => void }> = ({ id, onDone }) => {
  const [s, setS] = useState<any | null>(null);
  const [answered, setAnswered] = useState(false);
  const [a, setA] = useState<Record<string, any>>({});
  const { busy, note, run } = useRunner();
  useEffect(() => { workplaceService.survey(id).then((r) => { setS(r.survey); setAnswered(r.answered); }).catch(() => undefined); }, [id]);
  if (!s) return <p className="text-sm text-slate-400">Loading…</p>;
  if (answered) return <Notice tone="ok">You have answered this survey. Thank you.</Notice>;
  return (
    <Card title={s.title} subtitle={s.anonymous ? 'Anonymous: your name is not stored with your answers.' : 'Your name is stored with your answers.'}>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <p className="text-sm text-slate-600 mb-3">{s.description}</p>
      <div className="space-y-4">
        {s.questions.map((q: any) => (
          <div key={q.id}>
            <p className="text-sm font-semibold text-slate-800">{q.text}{q.required && <span className="text-rose-500"> *</span>}</p>
            {(q.type === 'RATING' || q.type === 'NPS') && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">{Array.from({ length: q.type === 'RATING' ? 5 : 11 }, (_, i) => (q.type === 'RATING' ? i + 1 : i)).map((n) => (
                <button key={n} className={`w-9 h-9 rounded-lg text-xs font-bold border ${a[q.id] === n ? 'bg-[#6d4cf0] text-white border-transparent' : 'bg-white border-slate-300'}`} onClick={() => setA({ ...a, [q.id]: n })}>{n}</button>))}</div>
            )}
            {q.type === 'CHOICE' && q.options.map((o: string) => <label key={o} className="flex items-center gap-2 text-sm mt-1"><input type="radio" name={q.id} checked={a[q.id] === o} onChange={() => setA({ ...a, [q.id]: o })} />{o}</label>)}
            {q.type === 'MULTI' && q.options.map((o: string) => <label key={o} className="flex items-center gap-2 text-sm mt-1"><input type="checkbox" checked={(a[q.id] || []).includes(o)} onChange={(e) => setA({ ...a, [q.id]: e.target.checked ? [...(a[q.id] || []), o] : (a[q.id] || []).filter((x: string) => x !== o) })} />{o}</label>)}
            {q.type === 'TEXT' && <textarea className={input + ' mt-1 h-20'} maxLength={2000} value={a[q.id] || ''} onChange={(e) => setA({ ...a, [q.id]: e.target.value })} />}
          </div>
        ))}
      </div>
      <div className="mt-4"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.respond(id, a); onDone(); })}>Submit</button></div>
    </Card>
  );
};

const Results: React.FC<{ id: string }> = ({ id }) => {
  const [r, setR] = useState<any | null>(null);
  useEffect(() => { workplaceService.results(id).then(setR).catch(() => undefined); }, [id]);
  if (!r) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <Card title={`Results: ${r.survey.title}`} subtitle={`${r.responses} of ${r.invited} answered`}>
      {r.hidden ? <Notice tone="info">{r.message}</Notice> : r.questions.map((q: any) => (
        <div key={q.id} className="mb-4">
          <p className="text-sm font-semibold">{q.text} <span className="text-xs font-normal text-slate-400">({q.answered} answered)</span></p>
          {q.type === 'RATING' && <p className="text-xs text-slate-600">Average {q.average ?? '–'} · {q.distribution.map((n: number, i: number) => `${i + 1}★ ${n}`).join(' · ')}</p>}
          {q.type === 'NPS' && <p className="text-xs text-slate-600">Score {q.score ?? '–'} · promoters {q.promoters} · passives {q.passives} · detractors {q.detractors}</p>}
          {(q.type === 'CHOICE' || q.type === 'MULTI') && Object.entries(q.counts).map(([o, n]: any) => <div key={o} className="flex items-center gap-2 text-xs"><span className="w-40 truncate">{o}</span><div className="h-2 bg-violet-400 rounded" style={{ width: `${Math.max(2, (n / Math.max(1, q.answered)) * 200)}px` }} /><span>{n}</span></div>)}
          {q.type === 'TEXT' && <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1">{q.texts.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}
        </div>
      ))}
    </Card>
  );
};

export const Surveys: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [open, setOpen] = useState<{ kind: 'answer' | 'results'; id: string } | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(async () => { const r = await workplaceService.surveys(); setItems(r.items); setCanManage(r.canManage); }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  if (open?.kind === 'answer') return <div className="max-w-2xl space-y-3"><button className={btnGhost} onClick={() => { setOpen(null); load(); }}>‹ Back</button><Answer id={open.id} onDone={() => { setOpen(null); load(); }} /></div>;
  if (open?.kind === 'results') return <div className="max-w-2xl space-y-3"><button className={btnGhost} onClick={() => setOpen(null)}>‹ Back</button><Results id={open.id} /></div>;

  const q = (i: number, p: any) => setDraft({ ...draft, questions: draft.questions.map((x: any, j: number) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="space-y-4 max-w-3xl">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {canManage && !draft && <button className={btnPrimary} onClick={() => setDraft(blank())}>New survey</button>}
      {draft && (
        <Card title="New survey" right={<button className={btnGhost} onClick={() => setDraft(null)}>Cancel</button>}>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title"><input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="Closes on (optional)"><input type="date" className={input} value={draft.closesAt} onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="Description"><input className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field></div>
          </div>
          <label className="flex items-center gap-2 text-xs mt-3"><input type="checkbox" checked={draft.anonymous} onChange={(e) => setDraft({ ...draft, anonymous: e.target.checked })} /> Anonymous (results show once 5 people have answered)</label>
          {draft.questions.map((x: any, i: number) => (
            <div key={i} className="mt-3 border border-slate-200 rounded-xl p-3 grid md:grid-cols-[10rem_1fr_auto] gap-2 items-start">
              <select className={input} value={x.type} onChange={(e) => q(i, { type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <div className="space-y-2">
                <input className={input} placeholder="Question" value={x.text} onChange={(e) => q(i, { text: e.target.value })} />
                {(x.type === 'CHOICE' || x.type === 'MULTI') && <textarea className={input + ' h-16'} placeholder="One option per line" value={(x.options || []).join('\n')} onChange={(e) => q(i, { options: e.target.value.split('\n') })} />}
              </div>
              <div className="flex items-center gap-2 text-xs"><label><input type="checkbox" checked={x.required} onChange={(e) => q(i, { required: e.target.checked })} /> Required</label>{draft.questions.length > 1 && <button className={btnDanger} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_: any, j: number) => j !== i) })}>×</button>}</div>
            </div>
          ))}
          <div className="mt-3 flex gap-2">
            <button className={btnGhost} onClick={() => setDraft({ ...draft, questions: [...draft.questions, { type: 'RATING', text: '', required: true, options: ['', ''] }] })}>Add question</button>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const r = await workplaceService.saveSurvey(draft); await workplaceService.publishSurvey(r.id); setDraft(null); await load(); })}>Save and publish</button>
          </div>
        </Card>
      )}
      {items.map((s) => (
        <Card key={s.id}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-bold text-slate-900">{s.title}</p><p className="text-xs text-slate-500">{s.anonymous ? 'Anonymous' : 'Named'} · {s.questions} questions{s.closesAt ? ` · closes ${s.closesAt}` : ''}{canManage ? ` · ${s.status} · ${s.responses} answers` : ''}</p></div>
            <div className="flex gap-1.5 shrink-0">
              {s.status === 'OPEN' && (s.answered ? <span className="text-xs text-emerald-700 font-bold py-2">Answered</span> : <button className={btnPrimary} onClick={() => setOpen({ kind: 'answer', id: s.id })}>Answer</button>)}
              {canManage && <button className={btnGhost} onClick={() => setOpen({ kind: 'results', id: s.id })}>Results</button>}
              {canManage && s.status === 'OPEN' && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await workplaceService.closeSurvey(s.id); await load(); })}>Close</button>}
              {canManage && <button className={btnDanger} disabled={busy} onClick={() => { if (window.confirm('Delete this survey and all its answers?')) run(async () => { await workplaceService.deleteSurvey(s.id); await load(); }); }}>Delete</button>}
            </div>
          </div>
        </Card>
      ))}
      {items.length === 0 && <p className="text-sm text-slate-400">No surveys right now.</p>}
    </div>
  );
};
