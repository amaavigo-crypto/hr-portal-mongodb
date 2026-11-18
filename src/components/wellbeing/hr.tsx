import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Eye, History, Minus, Search, ShieldAlert, Users } from 'lucide-react';
import { wellbeingService } from '../../services/wellbeingService';
import { Card, ConfirmButton, EmptyState, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { ACCENT } from './common';

const PURPOSE = 'Use this for development and team planning, not for pay, promotion or discipline.';
const SKILL_COLOR: Record<string, string> = { reaction: '#ff7a59', impulse: '#f59e0b', memory: '#7c5cff', detail: '#0ea5a4' };

const Trend: React.FC<{ v: number | null | undefined }> = ({ v }) => {
  if (v === null || v === undefined) return <span className="text-[11px] text-slate-400">no trend yet</span>;
  if (Math.abs(v) < 2) return <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-500"><Minus className="w-3 h-3" />steady</span>;
  return v > 0 ? <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600"><ArrowUpRight className="w-3 h-3" />+{v}</span> : <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600"><ArrowDownRight className="w-3 h-3" />{v}</span>;
};
const Bar: React.FC<{ id: string; label: string; level: number | null; sub?: React.ReactNode; trend?: number | null; empty: string }> = ({ id, label, level, sub, trend, empty }) => (
  <div>
    <div className="flex items-baseline justify-between"><span className="text-sm font-bold text-slate-800">{label}</span>{level !== null ? <span className="text-sm font-black tabular-nums text-slate-900">{level}<span className="text-[10px] font-bold text-slate-400">/100</span></span> : null}</div>
    <div className="h-2.5 rounded-full bg-slate-100 mt-1.5 overflow-hidden">{level !== null && <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${level}%`, background: SKILL_COLOR[id] || '#7c5cff' }} />}</div>
    <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500"><span>{level === null ? empty : sub}</span>{level !== null && <Trend v={trend} />}</div>
  </div>
);

// ---------------------------------------------------------------- team overview

export const HrOverview: React.FC = () => {
  const { data, error, loading } = useLoad(() => wellbeingService.overview(), []);
  if (!data) return <Loading error={error} loading={loading} />;
  const skillLabel = (id: string) => data.skills.find((s: any) => s.id === id)?.label || id;
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <Notice tone="info">{PURPOSE} Groups with fewer than {data.minGroup} players are never shown, and nobody is ranked.</Notice>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Opted in</div><div className="text-3xl font-black text-slate-900 mt-1">{data.participation.percent}%</div><div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${data.participation.percent}%` }} /></div><div className="text-[11px] text-slate-500 mt-1.5">{data.participation.optedIn} of {data.participation.people} people</div></div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">People who have played</div><div className="text-3xl font-black text-slate-900 mt-1">{data.players}</div><div className="text-[11px] text-slate-500 mt-3.5">with at least one recorded game</div></div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Plays per person a week</div><div className="text-3xl font-black text-slate-900 mt-1">{data.playsPerWeek}</div><div className="text-[11px] text-slate-500 mt-3.5">over the last 4 weeks</div></div>
      </div>
      {data.groups.length === 0 ? (
        <Card><EmptyState icon={Users} title="No group is big enough to show yet" text={`A department appears here once at least ${data.minGroup} of its people have played. This keeps individuals from being picked out of an average.`} /></Card>
      ) : data.groups.map((g: any) => (
        <Card key={g.name} title={g.name} right={<Pill tone="blue">{g.players} players</Pill>} subtitle={g.relevant.length ? `Skills that matter for these roles: ${g.relevant.map(skillLabel).join(', ')}` : 'These roles have no skills selected in Role skills, so no skill averages are shown.'}>
          {g.relevant.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
              {g.relevant.map((id: string) => { const s = g.skills[id]; return <Bar key={id} id={id} label={skillLabel(id)} level={s ? s.level : null} trend={s?.trend} sub={s ? `${s.members} people` : ''} empty={`Not enough plays yet. Needs ${data.minGroup} people with ${data.minPlays} plays each.`} />; })}
            </div>
          )}
        </Card>
      ))}
      {data.hiddenGroups > 0 && <p className="text-xs text-slate-500 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" />{data.hiddenGroups} {data.hiddenGroups === 1 ? 'group has' : 'groups have'} fewer than {data.minGroup} players and {data.hiddenGroups === 1 ? 'is' : 'are'} not shown.</p>}
    </div>
  );
};

// ---------------------------------------------------------------- role skills

const LEVELS = [{ v: 0, label: 'Not used' }, { v: 1, label: 'Minor' }, { v: 2, label: 'Important' }, { v: 3, label: 'Core' }];

export const RoleProfiles: React.FC = () => {
  const { data, error, loading, reload } = useLoad(() => wellbeingService.roles(), []);
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>({});
  const { run, busy, note } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const current = (r: any) => edits[r.title] || r.weights;
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <Notice tone="info">Choose which skills matter for each job title. Players are offered the games that fit their role first, and HR sees only the skills marked here for that person. Starting values are a guess from the job title, so please check them. Leadership roles start with none.</Notice>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card>
        {data.rows.length === 0 ? <EmptyState icon={Users} title="No job titles yet" text="Titles appear here once people have a job title in People." /> : (
          <div className="divide-y divide-slate-100">
            {data.rows.map((r: any) => {
              const w = current(r); const dirty = !!edits[r.title];
              return (
                <div key={r.title} className="py-4 grid lg:grid-cols-[220px_1fr_auto] gap-3 lg:items-center">
                  <div><div className="text-sm font-extrabold text-slate-900">{r.title}</div><div className="text-[11px] text-slate-500">{r.people} {r.people === 1 ? 'person' : 'people'} · {r.matched}</div></div>
                  <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2.5">
                    {data.skills.map((s: any) => (
                      <label key={s.id} className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700" title={s.blurb}>
                        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SKILL_COLOR[s.id] }} />{s.label}</span>
                        <select className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white" value={w[s.id] ?? 0} onChange={(e) => setEdits((x) => ({ ...x, [r.title]: { ...current(r), [s.id]: Number(e.target.value) } }))}>
                          {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 lg:justify-end">
                    {dirty && <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(async () => { await wellbeingService.saveRole(r.title, edits[r.title]); setEdits((x) => { const n = { ...x }; delete n[r.title]; return n; }); await reload(); }, 'Saved.')}>Save</button>}
                    {dirty && <button type="button" className={btnGhost} onClick={() => setEdits((x) => { const n = { ...x }; delete n[r.title]; return n; })}>Undo</button>}
                    {!dirty && r.source === 'custom' && <ConfirmButton disabled={busy} question="Go back to the suggestion?" yes="Reset" className={btnGhost} onConfirm={() => run(async () => { await wellbeingService.resetRole(r.title); await reload(); }, 'Reset to the suggested skills.')}>Reset</ConfirmButton>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- people (one at a time, logged)

export const HrPeople: React.FC = () => {
  const { data, error, loading } = useLoad(() => wellbeingService.people(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [pic, setPic] = useState<any>(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<any[] | null>(null);
  const { run, busy, note } = useRunner();
  useEffect(() => { if (showLog) wellbeingService.audit().then((r) => setLog(r.rows)).catch(() => setLog([])); }, [showLog, pic]);
  if (!data) return <Loading error={error} loading={loading} />;
  const list = data.people.filter((p: any) => `${p.name} ${p.department} ${p.title}`.toLowerCase().includes(q.toLowerCase()));
  const look = (uid: string) => run(async () => { const r = await wellbeingService.person(uid); setPic(r); setOpen(null); });
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Notice tone="warn">Opening a person shows their skill picture for the skills that matter in their role, and the open is recorded in the access log with your name. {PURPOSE}</Notice>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {pic && (
        <Card title={pic.person.name} subtitle={`${pic.person.title}${pic.person.department ? ` · ${pic.person.department}` : ''}`} right={<button type="button" className={btnGhost} onClick={() => setPic(null)}>Close</button>}>
          <div className="text-xs text-slate-500 mb-4">{pic.plays} recorded plays{pic.lastPlayed ? `, last on ${new Date(pic.lastPlayed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>
          {pic.relevant.length === 0 ? <p className="text-sm text-slate-500">No skills are marked as relevant for this role, so there is nothing to show. You can change that in Role skills.</p> : (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
              {pic.relevant.map((r: any) => { const s = pic.skills[r.id]; return <Bar key={r.id} id={r.id} label={r.label} level={s ? s.level : null} trend={s?.trend} sub={s ? `${s.n} plays${s.confidence === 'low' ? ', early picture' : ''}` : ''} empty={`Not enough plays yet (needs ${pic.minPlays} on this skill).`} />; })}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-5">{pic.note} A game is a snapshot of one moment, not a measure of a person.</p>
        </Card>
      )}
      <Card title="People who have opted in" right={<div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className={`${input} pl-8 !w-52`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
        {list.length === 0 ? <EmptyState icon={Users} title="Nobody to show" text="People appear here once they have opted in and played." /> : (
          <ul className="divide-y divide-slate-100">
            {list.map((p: any) => (
              <li key={p.uid} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><div className="text-sm font-bold text-slate-800 truncate">{p.name}</div><div className="text-[11px] text-slate-500 truncate">{p.title}{p.department ? ` · ${p.department}` : ''} · {p.plays} plays</div></div>
                {open === p.uid
                  ? <span className="inline-flex items-center gap-1.5 text-xs"><span className="font-semibold text-slate-600">This will be logged.</span><button className={btnPrimary} disabled={busy} onClick={() => look(p.uid)}>Open</button><button className={btnGhost} onClick={() => setOpen(null)}>Cancel</button></span>
                  : <button type="button" className={btnGhost} onClick={() => setOpen(p.uid)}><Eye className="w-3.5 h-3.5" />View picture</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Access log" subtitle="Every time a person's picture is opened." right={<button type="button" className={btnGhost} onClick={() => setShowLog((v) => !v)}><History className="w-3.5 h-3.5" />{showLog ? 'Hide' : 'Show'}</button>}>
        {showLog && (log === null ? <p className="text-sm text-slate-500">Loading…</p> : log.length === 0 ? <p className="text-sm text-slate-500">Nobody has been opened yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{log.map((r) => <li key={r.id} className="py-2 flex items-center justify-between gap-3"><span className="min-w-0 truncate"><b className="text-slate-800">{r.actor}</b> <span className="text-slate-500">opened</span> <b className="text-slate-800">{r.target}</b></span><span className="text-[11px] text-slate-400 shrink-0">{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul>
        ))}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- settings

export const WellbeingSettings: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { data, error, loading } = useLoad(() => wellbeingService.settings(), []);
  const [games, setGames] = useState<string[] | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const { run, busy, note } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const on = games ?? data.enabledGames; const limit = cap ?? data.dailyCap;
  const toggle = (id: string) => setGames(on.includes(id) ? on.filter((g: string) => g !== id) : [...on, id]);
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Games on offer" subtitle="Players see only the games that are on.">
        <div className="space-y-2">
          {data.games.map((g: any) => { const a = ACCENT[g.id]; const checked = on.includes(g.id); return (
            <label key={g.id} className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors ${checked ? 'border-violet-300 bg-violet-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="checkbox" className="w-4 h-4 accent-violet-600" checked={checked} onChange={() => toggle(g.id)} />
              <span className="w-2.5 h-9 rounded-full" style={{ background: `linear-gradient(${a.from}, ${a.to})` }} />
              <span className="min-w-0"><span className="block text-sm font-bold text-slate-800">{g.name} <span className="text-[11px] font-semibold text-slate-400">· {g.minutes} min</span></span><span className="block text-xs text-slate-500">{g.tagline}</span></span>
            </label>
          ); })}
        </div>
      </Card>
      <Card title="Daily limit" subtitle="Plays per person per day. Plays without recording count too. This keeps it a break, not a habit.">
        <div className="flex items-center gap-3"><input type="range" min={1} max={data.maxCap} value={limit} onChange={(e) => setCap(Number(e.target.value))} className="flex-1 accent-violet-600" /><span className="w-20 text-sm font-black text-slate-900 tabular-nums">{limit} a day</span></div>
      </Card>
      <button type="button" className={btnPrimary} disabled={busy || on.length === 0} onClick={() => run(async () => { await wellbeingService.saveSettings(on, limit); setGames(null); setCap(null); onChanged(); }, 'Settings saved.')}>Save settings</button>
      {on.length === 0 && <p className="text-xs text-rose-600">Keep at least one game on.</p>}
    </div>
  );
};
