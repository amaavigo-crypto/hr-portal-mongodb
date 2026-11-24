import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileText, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2, Upload, Users, X,
} from 'lucide-react';
import { hrbpService } from '../../services/hrbpService';
import { inr, inrShort } from '../../../shared/projectPlanner';

/** HRBP AI Project Planner: brief (document or typed) -> checked brief -> team, plan, costs -> approve into Tasks. Server: api/_lib/projectPlannerApi.ts. */

const card = 'rounded-2xl border border-slate-200 bg-white';
const label = 'block text-[13px] font-semibold text-slate-800';
const field = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#C2410C] focus:outline-none focus:ring-2 focus:ring-[#FA7014]/25';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-5 py-3 text-sm font-bold text-white hover:bg-[#9A3412] disabled:opacity-50 transition-colors';
const ghost = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 transition-colors';
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
const niceDate = (d?: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const STATUS: Record<string, [string, string]> = {
  BRIEF: ['Check the brief', 'bg-sky-50 text-sky-800'], DRAFT: ['Draft', 'bg-orange-50 text-orange-800'], APPROVING: ['Approving', 'bg-orange-50 text-orange-800'], APPROVED: ['Approved', 'bg-emerald-50 text-emerald-800'],
};
const PHASE_TINTS = ['#BFDBFE', '#E9D5FF', '#FED7AA', '#BBF7D0', '#FDE68A', '#FBCFE8', '#C7D2FE', '#A5F3FC', '#FECACA', '#D9F99D'];
const AVATAR_TINTS = ['#FDE7D6', '#DBEAFE', '#DCFCE7', '#F3E8FF', '#FEF3C7', '#E0F2FE', '#FCE7F3', '#E2E8F0'];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const tintFor = (s: string) => AVATAR_TINTS[[...s].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];

const Err: React.FC<{ text?: string }> = ({ text }) => (text ? <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{text}</div> : null);

export const ProjectPlanner: React.FC = () => {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'plan'; id: string }>({ kind: 'list' });
  if (view.kind === 'new') return <NewProject onBack={() => setView({ kind: 'list' })} onMade={(id) => setView({ kind: 'plan', id })} />;
  if (view.kind === 'plan') return <PlanPage id={view.id} onBack={() => setView({ kind: 'list' })} />;
  return <PlanList onNew={() => setView({ kind: 'new' })} onOpen={(id) => setView({ kind: 'plan', id })} />;
};

// ------------------------------------------------------------------ list

const PlanList: React.FC<{ onNew: () => void; onOpen: (id: string) => void }> = ({ onNew, onOpen }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { hrbpService.get('plan-list').then(setData).catch((e) => setError(e.message)); }, []);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-[#0F172A] p-6 text-white md:p-8">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#FA7014]">AI project planner</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Turn a brief into a staffed, costed plan</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Upload a project document or describe it. The planner picks people by skills and availability, drafts phases and tasks, and works out cost, budget and profit. Nothing is assigned until you approve.</p>
        </div>
        <button type="button" onClick={onNew} disabled={data && !data.aiEnabled} className="inline-flex items-center gap-2 rounded-xl bg-[#FA7014] px-5 py-3 text-sm font-bold text-[#0F172A] hover:bg-[#fb8a3c] disabled:opacity-50"><Plus className="h-4 w-4" /> New project</button>
      </div>
      {data && !data.aiEnabled && <Err text="AI is not set up for this portal yet (OPENAI_API_KEY is missing), so new plans cannot be made." />}
      <Err text={error} />
      {!data && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans...</p>}
      {data && data.items.length === 0 && <div className={`${card} p-10 text-center text-sm text-slate-600`}>No plans yet. Start with <b>New project</b>.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data?.items || []).map((p: any) => (
          <button key={p.id} type="button" onClick={() => onOpen(p.id)} className={`${card} group p-5 text-left transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md`}>
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[p.status]?.[1] || 'bg-slate-100 text-slate-700'}`}>{STATUS[p.status]?.[0] || p.status}</span>
              <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#C2410C]" />
            </div>
            <p className="mt-3 text-lg font-bold text-slate-900">{p.name}</p>
            <p className="mt-1 text-xs text-slate-600">{p.startDate ? `${niceDate(p.startDate)} to ${niceDate(p.endDate)}` : 'Dates not set'}{p.team ? ` · ${p.team} people` : ''}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
              <div><p className="text-slate-500">Budget</p><p className="font-bold text-slate-900">{inrShort(p.budget)}</p></div>
              <div><p className="text-slate-500">Cost</p><p className="font-bold text-slate-900">{inrShort(p.total)}</p></div>
              <div><p className="text-slate-500">Margin</p><p className="font-bold text-slate-900">{p.margin === null ? '—' : `${p.margin}%`}</p></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ new project

const parseCosts = (t: string) => lines(t).map((l) => { const m = l.match(/^(.*?)[\s:|,-]+₹?\s*([\d,]+)$/); return m ? { label: m[1].trim(), amount: Number(m[2].replace(/,/g, '')) } : null; }).filter(Boolean);

const NewProject: React.FC<{ onBack: () => void; onMade: (id: string) => void }> = ({ onBack, onMade }) => {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<{ name: string; size: number; data: string } | null>(null);
  const [f, setF] = useState({ name: '', summary: '', budget: '', clientPrice: '', startDate: '', endDate: '', costs: '', extra: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const pick = (fl?: File | null) => {
    setError('');
    if (!fl) return;
    if (fl.size > 3 * 1024 * 1024) { setError('The file is larger than 3 MB. Upload a smaller copy, or write the details instead.'); return; }
    const r = new FileReader();
    r.onload = () => setFile({ name: fl.name, size: fl.size, data: String(r.result || '') });
    r.readAsDataURL(fl);
  };
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const money = (v: string) => (v.trim() ? Number(v.replace(/[₹,\s]/g, '')) : undefined);
      const body = mode === 'file'
        ? { mode, fileName: file?.name, data: file?.data, clientPrice: money(f.clientPrice), extra: f.extra }
        : { mode, name: f.name, summary: f.summary, budget: money(f.budget), clientPrice: money(f.clientPrice), startDate: f.startDate, endDate: f.endDate, otherCosts: parseCosts(f.costs) };
      const r = await hrbpService.post('plan-read', body);
      onMade(r.plan.id);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };
  const ready = mode === 'file' ? !!file : f.summary.trim().length >= 40;
  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> All plans</button>
      <div className="flex flex-wrap gap-6">
        <section className="min-w-0 flex-[999_1_560px] space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#C2410C]">New project</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Share the project however you have it</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">You will check what was understood before any plan is made.</p>
          </div>
          <div role="tablist" className="inline-flex gap-1 rounded-xl bg-slate-200/70 p-1">
            {([['file', 'Upload a document'], ['text', 'Write the details']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
          {mode === 'file' ? (
            <div className={`${card} space-y-5 p-6`}>
              <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }} className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center hover:border-orange-300 hover:bg-orange-50/40">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100"><Upload className="h-6 w-6 text-[#C2410C]" /></span>
                <span className="text-base font-semibold text-slate-900">Drop the project document here, or browse</span>
                <span className="text-xs text-slate-600">PDF, Word (.docx) or text, up to 3 MB. Proposals, client briefs, budget notes.</span>
                <input type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              {file && (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50"><FileText className="h-5 w-5 text-indigo-700" /></span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{file.name}</p><p className="text-xs text-slate-600">{Math.round(file.size / 1024)} KB</p></div>
                  <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="rounded-lg p-2.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <label className={label}>Client price (optional)<input className={field} inputMode="numeric" placeholder="₹ e.g. 22,00,000" value={f.clientPrice} onChange={set('clientPrice')} /><span className="mt-1 block text-xs font-normal text-slate-600">Needed to show profit. Empty = budget headroom only.</span></label>
                <label className={label}>Anything the document misses<input className={field} placeholder="e.g. must launch before Diwali" value={f.extra} onChange={set('extra')} /></label>
              </div>
            </div>
          ) : (
            <div className={`${card} grid gap-4 p-6 md:grid-cols-2`}>
              <label className={`${label} md:col-span-2`}>Project name<input className={field} placeholder="e.g. ShopKart mobile app" value={f.name} onChange={set('name')} /></label>
              <label className={`${label} md:col-span-2`}>The idea, goals and what must be delivered<textarea rows={6} className={field} placeholder="What are we building, for whom, what does done look like, which skills it needs..." value={f.summary} onChange={set('summary')} /></label>
              <label className={label}>Budget<input className={field} inputMode="numeric" placeholder="₹ total available" value={f.budget} onChange={set('budget')} /></label>
              <label className={label}>Client price (optional)<input className={field} inputMode="numeric" placeholder="₹ what the client pays" value={f.clientPrice} onChange={set('clientPrice')} /></label>
              <label className={label}>Start<input type="date" className={field} value={f.startDate} onChange={set('startDate')} /></label>
              <label className={label}>Deadline<input type="date" className={field} value={f.endDate} onChange={set('endDate')} /></label>
              <label className={`${label} md:col-span-2`}>Other costs (one per line)<textarea rows={3} className={field} placeholder={'Cloud hosting 40000\nFigma licence 8000'} value={f.costs} onChange={set('costs')} /></label>
            </div>
          )}
          <Err text={error} />
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className={primary} disabled={!ready || busy} onClick={submit}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading the brief...</> : <>Read it <ArrowRight className="h-4 w-4" /></>}</button>
            <span className="text-xs text-slate-600">Next you check what was understood. Nothing is assigned until you approve.</span>
          </div>
        </section>
        <Steps />
      </div>
    </div>
  );
};

const Steps: React.FC = () => (
  <aside className="min-w-0 flex-[1_1_300px] space-y-4">
    <div className="rounded-2xl bg-[#0F172A] p-6 text-white">
      <p className="text-lg font-bold">What happens next</p>
      <ol className="mt-4 space-y-4">
        {[['Read the brief', 'Goals, budget, deadline, deliverables and the skills needed. You check and correct it.'], ['Match your people', 'Scored on skill fit, who is free (leave, notice, other projects) and cost.'], ['Draft the plan', 'Phases, tasks with owners, timeline, risks, and cost against budget and price.'], ['You approve', 'One click creates the project in Tasks and assigns the work.']].map(([t, b], i) => (
          <li key={t} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FA7014] text-xs font-bold text-[#0F172A]">{i + 1}</span><div><p className="text-sm font-semibold">{t}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-300">{b}</p></div></li>
        ))}
      </ol>
    </div>
    <div className={`${card} flex gap-3 p-4`}><Lock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><p className="text-xs leading-relaxed text-slate-700"><b className="text-slate-900">Salaries never go to the AI.</b> It picks people by skills and availability; the portal works out every rupee.</p></div>
  </aside>
);

// ------------------------------------------------------------------ one plan

const PlanPage: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { hrbpService.get('plan-get', { id }).then((r) => setPlan(r.plan)).catch((e) => setError(e.message)); }, [id]);
  const back = <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> All plans</button>;
  if (error) return <div className="space-y-4">{back}<Err text={error} /></div>;
  if (!plan) return <div className="space-y-4">{back}<p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p></div>;
  return (
    <div className="space-y-5">
      {back}
      {plan.status === 'BRIEF' || editing
        ? <BriefEditor plan={plan} onSaved={(p) => { setPlan(p); setEditing(false); }} onCancel={plan.status !== 'BRIEF' ? () => setEditing(false) : undefined} />
        : <PlanView plan={plan} setPlan={setPlan} onEdit={() => setEditing(true)} onArchived={onBack} />}
    </div>
  );
};

// ------------------------------------------------------------------ brief editor

const BUILD_STEPS = ['Checking who is free', 'Matching skills to roles', 'Drafting phases and tasks', 'Working out cost and profit'];

const BriefEditor: React.FC<{ plan: any; onSaved: (p: any) => void; onCancel?: () => void }> = ({ plan, onSaved, onCancel }) => {
  const b = plan.brief;
  const [f, setF] = useState({
    name: b.name, summary: b.summary, startDate: b.startDate, endDate: b.endDate, budget: b.budget ?? '', clientPrice: b.clientPrice ?? '',
    goals: b.goals.join('\n'), deliverables: b.deliverables.join('\n'), constraints: b.constraints.join('\n'), costs: b.otherCosts.map((c: any) => `${c.label} ${c.amount}`).join('\n'),
  });
  const [roles, setRoles] = useState<any[]>(b.roles.map((r: any) => ({ ...r, skillsText: r.skills.join(', ') })));
  const [busy, setBusy] = useState<'' | 'save' | 'build'>('');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const timer = useRef<any>(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const setRole = (i: number, k: string, v: any) => setRoles(roles.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const payload = () => ({
    name: f.name, summary: f.summary, startDate: f.startDate, endDate: f.endDate,
    budget: String(f.budget).trim() ? Number(String(f.budget).replace(/[₹,\s]/g, '')) : null, clientPrice: String(f.clientPrice).trim() ? Number(String(f.clientPrice).replace(/[₹,\s]/g, '')) : null,
    goals: lines(f.goals), deliverables: lines(f.deliverables), constraints: lines(f.constraints), otherCosts: parseCosts(f.costs),
    roles: roles.filter((r) => r.title?.trim()).map((r) => ({ title: r.title, skills: String(r.skillsText || '').split(',').map((s: string) => s.trim()).filter(Boolean), count: Number(r.count) || 1, allocation: Number(r.allocation) || 100 })),
  });
  const go = async (build: boolean) => {
    setError(''); setBusy(build ? 'build' : 'save'); setStep(0);
    if (build) timer.current = setInterval(() => setStep((s) => Math.min(BUILD_STEPS.length - 1, s + 1)), 9000);
    try {
      const saved = await hrbpService.post('plan-brief', { id: plan.id, brief: payload() });
      onSaved(build ? (await hrbpService.post('plan-build', { id: plan.id })).plan : saved.plan);
    } catch (e: any) { setError(e.message); } finally { clearInterval(timer.current); setBusy(''); }
  };
  if (busy === 'build') return (
    <div className="mx-auto max-w-xl rounded-3xl bg-[#0F172A] p-8 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#FA7014]">Building the plan</p>
      <p className="mt-2 text-2xl font-black">{f.name}</p>
      <ol className="mt-6 space-y-3">
        {BUILD_STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-sm transition ${i <= step ? 'text-white' : 'text-slate-500'}`}>
            {i < step ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : i === step ? <Loader2 className="h-5 w-5 animate-spin text-[#FA7014]" /> : <span className="h-5 w-5 rounded-full border-2 border-slate-600" />}{s}
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-slate-400">This usually takes 20 to 60 seconds.</p>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#C2410C]">Step 1 of 2 · Check the brief</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Is this what the project is?</h2>
          <p className="mt-1 text-sm text-slate-600">{plan.source?.type === 'file' ? `Read from ${plan.source.fileName}. ` : ''}Fix anything that is wrong. The plan is built from exactly this.</p>
        </div>
        {onCancel && <button type="button" className={ghost} onClick={onCancel}>Cancel</button>}
      </div>
      {b.warnings?.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-semibold">Please check</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{b.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
      {plan.status !== 'BRIEF' && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Saving a changed brief clears the current team and plan; build again afterwards.</div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className={`${card} grid gap-4 p-6 md:grid-cols-2`}>
          <label className={`${label} md:col-span-2`}>Project name<input className={field} value={f.name} onChange={set('name')} /></label>
          <label className={`${label} md:col-span-2`}>Summary<textarea rows={4} className={field} value={f.summary} onChange={set('summary')} /></label>
          <label className={label}>Deliverables (one per line)<textarea rows={6} className={field} value={f.deliverables} onChange={set('deliverables')} /></label>
          <label className={label}>Goals (one per line)<textarea rows={6} className={field} value={f.goals} onChange={set('goals')} /></label>
          <label className={`${label} md:col-span-2`}>Constraints and must-haves (one per line)<textarea rows={3} className={field} value={f.constraints} onChange={set('constraints')} /></label>
        </div>
        <div className={`${card} space-y-4 p-6`}>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Start<input type="date" className={field} value={f.startDate} onChange={set('startDate')} /></label>
            <label className={label}>Deadline<input type="date" className={field} value={f.endDate} onChange={set('endDate')} /></label>
          </div>
          <label className={label}>Budget (₹)<input className={field} inputMode="numeric" value={f.budget} onChange={set('budget')} placeholder="Leave empty if unknown" /></label>
          <label className={label}>Client price (₹, optional)<input className={field} inputMode="numeric" value={f.clientPrice} onChange={set('clientPrice')} placeholder="Needed for profit" /></label>
          <label className={label}>Other costs (one per line: label amount)<textarea rows={4} className={field} value={f.costs} onChange={set('costs')} placeholder="Cloud hosting 40000" /></label>
        </div>
      </div>
      <div className={`${card} p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-lg font-bold text-slate-900">Roles needed</p><p className="text-xs text-slate-600">People are matched to these skills. Use short skill names separated by commas.</p></div>
          <button type="button" className={ghost} onClick={() => setRoles([...roles, { title: '', skillsText: '', count: 1, allocation: 100 }])}><Plus className="h-4 w-4" /> Add role</button>
        </div>
        <div className="mt-4 space-y-3">
          {roles.length === 0 && <p className="text-sm text-slate-600">No roles yet. Add the roles this project needs.</p>}
          {roles.map((r, i) => (
            <div key={i} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_2fr_90px_120px_44px]">
              <label className={label}>Role<input className={field} value={r.title} onChange={(e) => setRole(i, 'title', e.target.value)} placeholder="e.g. Mobile developer" /></label>
              <label className={label}>Skills<input className={field} value={r.skillsText} onChange={(e) => setRole(i, 'skillsText', e.target.value)} placeholder="React Native, REST APIs" /></label>
              <label className={label}>People<input type="number" min={1} max={10} className={field} value={r.count} onChange={(e) => setRole(i, 'count', e.target.value)} /></label>
              <label className={label}>Time<select className={field} value={r.allocation} onChange={(e) => setRole(i, 'allocation', Number(e.target.value))}>{[100, 80, 70, 60, 50, 40, 30, 20, 10].map((n) => <option key={n} value={n}>{n}%</option>)}</select></label>
              <button type="button" aria-label="Remove role" onClick={() => setRoles(roles.filter((_, j) => j !== i))} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>
      <Err text={error} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={!!busy || !roles.some((r) => r.title?.trim()) || !f.startDate || !f.endDate} onClick={() => go(true)}>Match people and build the plan <ArrowRight className="h-4 w-4" /></button>
        <button type="button" className={ghost} disabled={!!busy} onClick={() => go(false)}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save brief only</button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ plan view

const TABS = ['Overview', 'Team', 'Timeline', 'Budget', 'Tasks', 'Risks'] as const;
type Tab = typeof TABS[number];

const PlanView: React.FC<{ plan: any; setPlan: (p: any) => void; onEdit: () => void; onArchived: () => void }> = ({ plan, setPlan, onEdit, onArchived }) => {
  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const c = plan.costs;
  const p = plan.plan;
  const approved = plan.status === 'APPROVED';
  const act = async (what: string, fn: () => Promise<any>) => {
    setBusy(what); setMsg(null);
    try { const r = await fn(); if (r?.plan) setPlan(r.plan); if (r?.message) setMsg({ tone: 'ok', text: r.message }); } catch (e: any) { setMsg({ tone: 'error', text: e.message }); } finally { setBusy(''); setConfirming(false); }
  };
  const ringPct = c.margin !== null ? Math.max(0, Math.min(100, c.margin)) : c.budget ? Math.min(100, (c.total / c.budget) * 100) : 0;
  const ringLabel = c.margin !== null ? `${c.margin}%` : c.budget ? `${Math.round((c.total / c.budget) * 100)}%` : '—';
  const counts: Record<Tab, string> = { Overview: '', Team: String(plan.team.length), Timeline: `${c.weeks} wks`, Budget: '', Tasks: String(p.tasks.length), Risks: String(p.risks.length) };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[plan.status]?.[1]}`}>{STATUS[plan.status]?.[0]}</span>
            <span className="text-xs text-slate-600">{plan.source?.type === 'file' ? `From ${plan.source.fileName} · ` : ''}{niceDate(plan.brief.startDate)} to {niceDate(plan.brief.endDate)}</span>
          </div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">{plan.name}</h2>
        </div>
        {!approved && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghost} disabled={!!busy} onClick={onEdit}><Pencil className="h-4 w-4" /> Edit the brief</button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => act('replan', () => hrbpService.post('plan-build', { id: plan.id, keepTeam: true }))}>{busy === 'replan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-plan</button>
            <button type="button" className={primary} disabled={!!busy || !plan.canApprove} title={plan.canApprove ? '' : 'Needs the Tasks "manage" permission or a company admin'} onClick={() => setConfirming(true)}><Check className="h-4 w-4" /> Approve and assign tasks</button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-orange-300 bg-orange-50 p-5">
          <div className="min-w-0 flex-[1_1_360px]">
            <p className="font-bold text-slate-900">Approve this plan?</p>
            <p className="mt-1 text-sm text-slate-700">This creates a "{plan.name}" board in Tasks with {p.tasks.filter((t: any) => t.ownerUid).length} tasks, assigns them, books each person's time for these dates and sends one email per person.</p>
          </div>
          <button type="button" className={primary} disabled={!!busy} onClick={() => act('approve', () => hrbpService.post('plan-approve', { id: plan.id }))}>{busy === 'approve' ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating tasks...</> : 'Yes, approve'}</button>
          <button type="button" className={ghost} disabled={!!busy} onClick={() => setConfirming(false)}>Not yet</button>
        </div>
      )}
      {msg && <div role={msg.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}
      {approved && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" /> Approved {plan.approval?.by ? `by ${plan.approval.by}` : ''}. The tasks are on the "{plan.name}" board in Tasks.</div>}

      <section aria-label="Key numbers" className="flex flex-wrap items-center gap-8 rounded-3xl bg-[#0F172A] px-7 py-7 text-white">
        <div className="flex items-center gap-5">
          <div className="relative h-[104px] w-[104px]">
            <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={c.margin !== null ? `Margin ${ringLabel}` : `Budget used ${ringLabel}`}>
              <circle cx="52" cy="52" r="40" fill="none" stroke="#1E293B" strokeWidth="12" />
              <circle cx="52" cy="52" r="40" fill="none" stroke={c.margin !== null && c.margin < 0 ? '#F87171' : '#FA7014'} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(ringPct / 100) * 251.3} 251.3`} transform="rotate(-90 52 52)" style={{ transition: 'stroke-dasharray 0.8s ease' }} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-black">{ringLabel}</span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">{c.margin !== null ? 'Margin' : 'Budget used'}</p>
            <p className="mt-1 text-xs text-slate-300">{c.margin !== null ? (c.margin < 0 ? 'Loss at this price' : c.margin < 15 ? 'Thin margin' : 'Healthy margin') : c.budget ? 'Add a client price to see profit' : 'No budget or price given'}</p>
          </div>
        </div>
        <div className="grid min-w-0 flex-[1_1_520px] grid-cols-2 gap-6 md:grid-cols-4">
          {[
            ['Budget', inrShort(c.budget), c.budget === null ? 'Not given' : 'From the brief', ''],
            ['Planned cost', inrShort(c.total), c.budget ? `${Math.round((c.total / c.budget) * 100)}% of budget` : `${c.missingSalary ? `${c.missingSalary} without salary` : 'People and other costs'}`, ''],
            c.profit !== null ? ['Profit', inrShort(c.profit), `At ${inrShort(c.clientPrice)} price`, c.profit < 0 ? 'text-rose-300' : 'text-emerald-300'] : ['Headroom', inrShort(c.headroom), c.headroom === null ? 'No budget' : c.headroom < 0 ? 'Over budget' : 'Left in budget', c.headroom !== null && c.headroom < 0 ? 'text-rose-300' : 'text-emerald-300'],
            ['Team · time', `${new Set(plan.team.filter((a: any) => a.uid).map((a: any) => a.uid)).size} · ${c.weeks} wks`, `Ends ${niceDate(plan.brief.endDate)}`, ''],
          ].map(([l, v, n, tone]) => (
            <div key={l} className="border-l border-slate-700 pl-5">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">{l}</p>
              <p className={`mt-1.5 text-2xl font-black tracking-tight md:text-[28px] ${tone || 'text-white'}`}>{v}</p>
              <p className="mt-1 text-xs text-slate-300">{n}</p>
            </div>
          ))}
        </div>
      </section>

      <div role="tablist" aria-label="Plan sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px inline-flex items-center gap-2 border-b-[3px] px-4 py-3 text-sm transition ${tab === t ? 'border-[#FA7014] font-bold text-slate-900' : 'border-transparent font-medium text-slate-600 hover:text-slate-900'}`}>
            {t}{counts[t] && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tab === t ? 'bg-orange-100 text-orange-900' : 'bg-slate-100 text-slate-600'}`}>{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-[fadeIn_0.25s_ease]">
        {tab === 'Overview' && <Overview plan={plan} />}
        {tab === 'Team' && <Team plan={plan} setPlan={setPlan} locked={approved} />}
        {tab === 'Timeline' && <Timeline plan={plan} />}
        {tab === 'Budget' && <Budget plan={plan} />}
        {tab === 'Tasks' && <Tasks plan={plan} />}
        {tab === 'Risks' && <Risks plan={plan} />}
      </div>
      <style>{'@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}'}</style>

      <div className="flex justify-end">
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => act('archive', async () => { if (window.confirm(approved ? 'Archive this plan? The tasks stay in Tasks; the people it booked become free again.' : 'Archive this plan?')) { await hrbpService.post('plan-archive', { id: plan.id }); onArchived(); } })}><Trash2 className="h-3.5 w-3.5" /> Archive plan</button>
      </div>
    </div>
  );
};

const TONE: Record<string, [string, string]> = { good: ['bg-emerald-50', 'bg-emerald-600'], warn: ['bg-orange-50', 'bg-orange-600'], bad: ['bg-rose-50', 'bg-rose-600'] };

const Overview: React.FC<{ plan: any }> = ({ plan }) => (
  <div className="flex flex-wrap gap-6">
    <div className="min-w-0 flex-[999_1_560px] space-y-6">
      <div className={`${card} p-7`}>
        <p className="mb-3 text-sm font-bold text-[#C2410C]">In short</p>
        <p className="text-[17px] leading-relaxed text-slate-800">{plan.plan.summary || plan.brief.summary}</p>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-900">{plan.headline}</p>
      </div>
      {plan.brief.deliverables.length > 0 && (
        <div className={`${card} p-7`}>
          <p className="mb-4 text-lg font-bold text-slate-900">What will be delivered</p>
          <ul className="grid gap-3 md:grid-cols-2">{plan.brief.deliverables.map((d: string) => <li key={d} className="flex gap-2.5 text-sm leading-relaxed text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />{d}</li>)}</ul>
        </div>
      )}
    </div>
    <div className={`${card} min-w-0 flex-[1_1_320px] space-y-3 p-7`}>
      <p className="mb-1 text-lg font-bold text-slate-900">Plan health</p>
      {plan.health.map((h: any) => (
        <div key={h.title} className={`flex gap-3 rounded-xl p-3.5 ${TONE[h.tone]?.[0]}`}>
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TONE[h.tone]?.[1]}`} />
          <div><p className="text-sm font-semibold text-slate-900">{h.title}</p><p className="mt-0.5 text-[13px] leading-relaxed text-slate-700">{h.body}</p></div>
        </div>
      ))}
    </div>
  </div>
);

const Team: React.FC<{ plan: any; setPlan: (p: any) => void; locked: boolean }> = ({ plan, setPlan, locked }) => {
  const [swap, setSwap] = useState<string>('');
  const cost = (key: string) => plan.costs.people.find((x: any) => x.key === key);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">{plan.canSeePay ? 'You see each person\'s cost because you have payroll access. Others see the team total only.' : 'Per-person cost is shown only to people with payroll access.'}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plan.team.map((a: any) => {
          const pc = cost(a.key);
          return (
            <article key={a.key} className={`${card} flex flex-col gap-4 p-5 ${!a.uid ? 'border-dashed border-orange-300 bg-orange-50/50' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-slate-900" style={{ background: a.uid ? tintFor(a.name) : '#FFEDD5' }}>{a.uid ? initials(a.name) : <Users className="h-5 w-5 text-orange-700" />}</span>
                <div className="min-w-0"><p className="truncate font-bold text-slate-900">{a.uid ? a.name : 'Nobody found'}</p><p className="truncate text-xs text-slate-600">{a.role}{a.title ? ` · ${a.title}` : ''}</p></div>
              </div>
              {a.uid && (
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-slate-600"><span>Skill fit</span><span className="font-bold text-slate-900">{a.fit}%</span></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-[#FA7014] transition-all duration-700" style={{ width: `${a.fit}%` }} /></div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {a.matched.map((s: string) => <span key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{s}</span>)}
                {a.missing.map((s: string) => <span key={s} className="rounded-full border border-orange-300 px-2.5 py-1 text-xs text-orange-800">needs {s}</span>)}
              </div>
              {a.notes.length > 0 && <ul className="space-y-1 text-xs text-slate-600">{a.notes.map((n: string) => <li key={n}>• {n}</li>)}</ul>}
              <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                <div><p className="text-xs text-slate-600">Allocation</p><p className="font-bold text-slate-900">{a.uid ? `${a.allocation}%` : '—'}</p></div>
                <div><p className="text-xs text-slate-600">Cost on project</p><p className="font-bold text-slate-900">{plan.canSeePay ? (pc?.cost === null || pc?.cost === undefined ? '—' : inr(pc.cost)) : 'Hidden'}</p></div>
              </div>
              {!locked && <button type="button" className={`${ghost} py-2 text-xs`} onClick={() => setSwap(swap === a.key ? '' : a.key)}>{a.uid ? 'Swap person' : 'Choose someone'}</button>}
              {swap === a.key && <SwapPicker plan={plan} seat={a} onDone={(p) => { setPlan(p); setSwap(''); }} />}
            </article>
          );
        })}
      </div>
    </div>
  );
};

const SwapPicker: React.FC<{ plan: any; seat: any; onDone: (p: any) => void }> = ({ plan, seat, onDone }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { hrbpService.get('plan-people', { id: plan.id, key: seat.key }).then((r) => setRows(r.items)).catch((e) => setError(e.message)); }, [plan.id, seat.key]);
  const choose = async (uid: string) => {
    setBusy(uid); setError('');
    try { onDone((await hrbpService.post('plan-swap', { id: plan.id, key: seat.key, uid })).plan); } catch (e: any) { setError(e.message); setBusy(''); }
  };
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
      <Err text={error} />
      {!rows && !error && <p className="flex items-center gap-2 p-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding people...</p>}
      {rows?.length === 0 && <p className="p-2 text-xs text-slate-600">Nobody else has free time in this window.</p>}
      {rows?.map((r) => (
        <button key={r.uid} type="button" disabled={!!busy || r.uid === seat.uid} onClick={() => choose(r.uid)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-orange-50 disabled:opacity-50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold" style={{ background: tintFor(r.name) }}>{initials(r.name)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{r.name}{r.uid === seat.uid ? ' (current)' : ''}</span><span className="block truncate text-xs text-slate-600">{r.title || 'No title'} · {r.free}% free{r.leaveDays ? ` · ${r.leaveDays}d leave` : ''}</span></span>
          <span className="text-xs font-bold text-slate-900">{busy === r.uid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `${r.fit}%`}</span>
        </button>
      ))}
    </div>
  );
};

const Timeline: React.FC<{ plan: any }> = ({ plan }) => {
  const W = plan.costs.weeks;
  const tint = (i: number) => PHASE_TINTS[i % PHASE_TINTS.length];
  const owner = (name: string) => { const t = plan.plan.tasks.filter((x: any) => x.phase === name && x.ownerName); const by = new Map<string, number>(); t.forEach((x: any) => by.set(x.ownerName, (by.get(x.ownerName) || 0) + x.days)); return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
  const cols = { gridTemplateColumns: `180px repeat(${W}, minmax(36px, 1fr))` };
  return (
    <div className={`${card} overflow-x-auto p-6`}>
      <div className="space-y-3" style={{ minWidth: 180 + W * 44 }}>
        <div className="grid gap-1.5 text-xs font-semibold text-slate-600" style={cols}><span>Phase</span>{Array.from({ length: W }, (_, i) => <span key={i} className="text-center">W{i + 1}</span>)}</div>
        {plan.plan.phases.map((ph: any, i: number) => (
          <div key={ph.name} className="grid items-center gap-1.5" style={cols}>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{ph.name}</p><p className="truncate text-xs text-slate-600">{owner(ph.name)}</p></div>
            <div className="flex h-9 items-center overflow-hidden whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-slate-900" style={{ gridColumn: `${ph.startWeek + 1} / span ${ph.weeks}`, background: tint(i) }}>{niceDate(ph.startDate).replace(/ \d{4}$/, '')} – {niceDate(ph.endDate).replace(/ \d{4}$/, '')}</div>
          </div>
        ))}
        {plan.plan.milestones.length > 0 && (
          <div className="flex flex-wrap gap-5 border-t border-slate-100 pt-4">
            {plan.plan.milestones.map((m: any) => <div key={m.label} className="flex items-center gap-2 text-sm text-slate-700"><span className="h-2.5 w-2.5 rotate-45 bg-[#0F172A]" /><b className="text-slate-900">W{m.week}</b> {m.label}</div>)}
          </div>
        )}
      </div>
    </div>
  );
};

const Budget: React.FC<{ plan: any }> = ({ plan }) => {
  const c = plan.costs;
  const max = Math.max(1, ...c.byPhase.map((x: any) => x.amount));
  return (
    <div className="flex flex-wrap gap-6">
      <div className={`${card} min-w-0 flex-[1_1_520px] space-y-6 p-7`}>
        <p className="text-lg font-bold text-slate-900">Where the money goes</p>
        {c.budget !== null && (
          <div>
            <div className="mb-2 flex justify-between text-sm"><span className="text-slate-600">Planned cost against budget</span><span className="font-bold">{inrShort(c.total)} of {inrShort(c.budget)}</span></div>
            <div className="h-4 rounded-full bg-slate-100"><div className={`h-4 rounded-full transition-all duration-700 ${c.total > c.budget ? 'bg-rose-600' : 'bg-[#0F172A]'}`} style={{ width: `${Math.min(100, (c.total / c.budget) * 100)}%` }} /></div>
            <p className={`mt-2 text-xs font-semibold ${c.headroom < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{c.headroom < 0 ? `${inr(-c.headroom)} over budget` : `${inr(c.headroom)} left in the budget`}</p>
          </div>
        )}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-600">By phase</p>
          {c.byPhase.map((b: any, i: number) => (
            <div key={b.name} className="grid grid-cols-[120px_1fr_100px] items-center gap-3 text-sm">
              <span className="truncate font-semibold">{b.name}</span>
              <div className="h-2.5 rounded-full bg-slate-100"><div className="h-2.5 rounded-full transition-all duration-700" style={{ width: `${(b.amount / max) * 100}%`, background: i % 2 ? '#FED7AA' : '#FA7014' }} /></div>
              <span className="text-right font-semibold">{inr(b.amount)}</span>
            </div>
          ))}
        </div>
        {plan.canSeePay && c.byRole.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-600">By role</p>
            {c.byRole.map((r: any) => <div key={r.role} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{r.role}</span><span className="font-semibold">{inr(r.amount)}</span></div>)}
          </div>
        )}
      </div>
      <div className={`${card} min-w-0 flex-[1_1_340px] p-7`}>
        <p className="mb-3 text-lg font-bold text-slate-900">{c.profit !== null ? 'Profit, step by step' : 'Cost, step by step'}</p>
        {c.clientPrice !== null && <div className="flex justify-between border-b border-slate-100 py-3 text-sm text-slate-900"><span>Client price</span><b>{inr(c.clientPrice)}</b></div>}
        <div className="flex justify-between border-b border-slate-100 py-3 text-sm text-slate-700"><span>People ({c.people.length}, by allocation)</span><b>{c.clientPrice !== null ? '− ' : ''}{inr(c.peopleTotal)}</b></div>
        {plan.brief.otherCosts.map((o: any) => <div key={o.label} className="flex justify-between border-b border-slate-100 py-3 text-sm text-slate-700"><span>{o.label}</span><b>{c.clientPrice !== null ? '− ' : ''}{inr(o.amount)}</b></div>)}
        <div className={`mt-2 flex justify-between rounded-xl px-4 py-3.5 text-base ${c.profit === null ? 'bg-slate-100 text-slate-900' : c.profit < 0 ? 'bg-rose-50 text-rose-900' : 'bg-emerald-50 text-emerald-900'}`}>
          <span>{c.profit !== null ? 'Profit' : 'Total cost'}</span><b>{inr(c.profit !== null ? c.profit : c.total)}</b>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">People cost = daily cost from annual CTC (÷ 260 working days) × {c.workdays} working days × allocation. Worked out by the portal, never by the AI.{c.missingSalary ? ` ${c.missingSalary} person(s) without a salary structure are not counted.` : ''}</p>
      </div>
    </div>
  );
};

const Tasks: React.FC<{ plan: any }> = ({ plan }) => {
  const phaseTint = new Map<string, string>(plan.plan.phases.map((ph: any, i: number) => [ph.name, PHASE_TINTS[i % PHASE_TINTS.length]]));
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead><tr className="bg-slate-50 text-left text-xs text-slate-600"><th className="px-6 py-3.5 font-semibold">Task</th><th className="px-3 py-3.5 font-semibold">Phase</th><th className="px-3 py-3.5 font-semibold">Owner</th><th className="px-3 py-3.5 font-semibold">Effort</th><th className="px-6 py-3.5 font-semibold">Due</th></tr></thead>
          <tbody>
            {plan.plan.tasks.map((t: any) => (
              <tr key={t.key} className="border-t border-slate-100 align-top">
                <td className="px-6 py-3.5"><p className="font-semibold text-slate-900">{t.title}</p>{t.description && <p className="mt-0.5 text-xs text-slate-600">{t.description}</p>}</td>
                <td className="px-3 py-3.5"><span className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-slate-900" style={{ background: phaseTint.get(t.phase) }}>{t.phase}</span></td>
                <td className="px-3 py-3.5">{t.ownerName ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold" style={{ background: tintFor(t.ownerName) }}>{initials(t.ownerName)}</span>{t.ownerName}</span> : <span className="text-xs text-orange-800">No owner (gap)</span>}</td>
                <td className="whitespace-nowrap px-3 py-3.5 text-slate-700">{t.days} day{t.days === 1 ? '' : 's'}</td>
                <td className="whitespace-nowrap px-6 py-3.5 text-slate-700">{niceDate(t.dueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-6 py-3.5 text-xs text-slate-600">{plan.status === 'APPROVED' ? 'These tasks were created in Tasks.' : 'Created in Tasks when you approve. Tasks without an owner are skipped until someone fills the role.'}</p>
    </div>
  );
};

const RISK: Record<string, string> = { High: 'bg-rose-100 text-rose-900', Medium: 'bg-orange-100 text-orange-900', Low: 'bg-emerald-100 text-emerald-900' };
const Risks: React.FC<{ plan: any }> = ({ plan }) => (
  plan.plan.risks.length === 0 ? <div className={`${card} p-8 text-sm text-slate-600`}>No risks were listed. Re-plan to ask again.</div> : (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {plan.plan.risks.map((r: any) => (
        <article key={r.title} className={`${card} flex flex-col gap-3 p-6`}>
          <span className={`self-start rounded-full px-2.5 py-1 text-xs font-bold ${RISK[r.level]}`}>{r.level}</span>
          <p className="font-bold text-slate-900">{r.title}</p>
          <p className="text-[13px] leading-relaxed text-slate-700">{r.body}</p>
          {r.fix && <p className="border-t border-slate-100 pt-3 text-[13px] leading-relaxed text-slate-900"><b>What to do:</b> {r.fix}</p>}
        </article>
      ))}
    </div>
  )
);
