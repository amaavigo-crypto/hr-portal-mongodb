import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import type { User } from '../../types';
import { pipelineService } from '../../services/pipelineService';
import { offerService } from '../../services/hiringExtraService';
import { flowService, type FlowTask } from '../../services/flowService';
import { hasModulePermission } from '../../utils/authorization';
import { FeedbackPanel } from '../hiring/InterviewsTab';
import { awaitingMyFeedback } from '../hiring/shell/homeData';

/** Hiring on the phone: what needs you, a short candidate card and interview feedback. It uses the same server rules as the website. */

const big = 'w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50';
const solid = `${big} bg-[#4C3EB0] text-white active:bg-[#3F3393]`;
const outline = `${big} border-2 border-slate-200 bg-white text-slate-800`;
const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base';
const card = 'rounded-2xl border border-slate-200 bg-white p-4';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export interface HiringWork {
  loading: boolean; error: string; talent: boolean; founder: boolean;
  feedback: any[]; offers: any[]; tasks: FlowTask[]; interviews: any[]; reload: () => Promise<void>;
}

/** What is waiting for this person. Each part loads on its own, so one failure does not hide the others. */
export function useHiringWork(user: User): HiringWork {
  const talent = hasModulePermission(user, 'talent-acquisition');
  const founder = !!user.isCompanyAdmin || !!user.perms?.includes('req.founder_decide');
  const [state, setState] = useState({ loading: true, error: '', interviews: [] as any[], offers: [] as any[], tasks: [] as FlowTask[] });
  const reload = useCallback(async () => {
    const [iv, tk, of] = await Promise.allSettled([
      pipelineService.interviews(), flowService.tasks(), founder ? offerService.list('PENDING_FOUNDER') : Promise.resolve({ items: [] }),
    ]);
    const failed = [iv, tk, of].filter((r) => r.status === 'rejected').length;
    setState({
      loading: false, error: failed ? 'Some items could not be loaded. Pull up the app again to retry.' : '',
      interviews: iv.status === 'fulfilled' ? (iv.value as any).items || [] : [],
      tasks: tk.status === 'fulfilled' ? (tk.value as any).open || [] : [],
      offers: of.status === 'fulfilled' ? (of.value as any).items || [] : [],
    });
  }, [founder]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, talent, founder, feedback: awaitingMyFeedback(state.interviews, Date.now()), reload };
}

const Back: React.FC<{ onClick: () => void }> = ({ onClick }) => <button type="button" onClick={onClick} className="flex items-center gap-1.5 py-1 text-sm font-bold text-[#3F3393]"><ArrowLeft className="h-4 w-4" />Back</button>;

const OfferCard: React.FC<{ o: any; onDone: () => Promise<void> }> = ({ o, onDone }) => {
  const [mode, setMode] = useState<'' | 'approve' | 'reject'>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !note.trim()) return setError('Say why you are rejecting it.');
    setBusy(true); setError('');
    try { await offerService.act({ id: o.id, action, note: note.trim() }); await onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className={card}>
      <p className="text-xs font-bold uppercase text-slate-500">Approve offer</p>
      <p className="mt-1 font-bold text-slate-900">{o.candidateName}</p>
      <p className="text-sm text-slate-600">{o.designation}</p>
      <p className="mt-2 text-lg font-extrabold">₹{o.recommendedCtcLpa} lakhs a year</p>
      {o.bandMaxLpa ? <p className={`text-sm ${o.overBand ? 'font-bold text-rose-700' : 'text-slate-600'}`}>Budget up to ₹{o.bandMaxLpa} lakhs{o.overBand ? ' · above budget' : ''}</p> : null}
      {o.justification && <p className="mt-1 text-sm text-slate-600">{o.justification}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      {mode === '' ? (
        <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className={solid} onClick={() => setMode('approve')}>Approve</button><button type="button" className={outline} onClick={() => setMode('reject')}>Reject</button></div>
      ) : (
        <div className="mt-3 space-y-2">
          {mode === 'approve'
            ? <p className="text-sm text-slate-700">{o.autoSend ? 'Approving sends this offer to the candidate straight away.' : 'Approve this offer? HR sends it after your approval.'}</p>
            : <textarea rows={2} autoFocus aria-label="Reason" placeholder="Why are you rejecting it?" value={note} onChange={(e) => setNote(e.target.value)} className={field} />}
          <div className="grid grid-cols-2 gap-2"><button type="button" className={outline} onClick={() => { setMode(''); setError(''); }}>Cancel</button><button type="button" disabled={busy} className={mode === 'approve' ? solid : `${big} bg-rose-600 text-white`} onClick={() => act(mode)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === 'approve' ? 'Yes, approve' : 'Reject offer'}</button></div>
        </div>
      )}
    </li>
  );
};

const TaskCard: React.FC<{ t: FlowTask; onDone: () => Promise<void> }> = ({ t, onDone }) => {
  const [no, setNo] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (d: 'yes' | 'no') => {
    setBusy(true); setError('');
    try { await flowService.decide(t.id, d, why.trim() || undefined); await onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className={card}>
      <p className="text-xs font-bold uppercase text-slate-500">{t.stepTitle}{t.late ? <span className="text-rose-600"> · late</span> : null}</p>
      <p className="mt-1 font-bold text-slate-900">{t.candidateName}</p>
      <p className="text-sm text-slate-600">{t.designation}</p>
      <p className="mt-2 text-sm text-slate-800">{t.decide ? t.question || t.instruction : t.instruction}</p>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      {!t.decide ? <p className="mt-2 text-xs text-slate-500">Do this in the hiring screens on a computer. It finishes by itself.</p>
        : no ? (
          <div className="mt-3 space-y-2">
            <textarea rows={2} autoFocus aria-label="Reason" placeholder="Short reason" value={why} onChange={(e) => setWhy(e.target.value)} className={field} />
            <div className="grid grid-cols-2 gap-2"><button type="button" className={outline} onClick={() => setNo(false)}>Cancel</button><button type="button" disabled={busy || !why.trim()} className={solid} onClick={() => decide('no')}>Send No</button></div>
          </div>
        ) : <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={solid} onClick={() => decide('yes')}>Yes</button><button type="button" className={outline} onClick={() => setNo(true)}>No</button></div>}
    </li>
  );
};

const Schedule: React.FC<{ applicationId: string; users: User[]; onDone: () => void; onCancel: () => void }> = ({ applicationId, users, onDone, onCancel }) => {
  const [f, setF] = useState({ startLocal: '', durationMinutes: '45', mode: 'Video', location: '', round: 'Interview' });
  const [panel, setPanel] = useState<string[]>([]);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clash, setClash] = useState(false);
  const staff = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const send = async (force: boolean) => {
    setBusy(true); setError(''); setClash(false);
    try {
      await pipelineService.schedule({ ...f, applicationId, panel, startIso: new Date(f.startLocal).toISOString(), durationMinutes: Number(f.durationMinutes), force });
      onDone();
    } catch (e) { const m = (e as Error).message; setError(m); setClash(/already has an interview/i.test(m)); } finally { setBusy(false); }
  };
  return (
    <div className={`${card} space-y-3`}>
      <p className="font-bold text-slate-900">Schedule an interview</p>
      <label className="block text-sm font-semibold">Date and time<input type="datetime-local" value={f.startLocal} onChange={(e) => setF({ ...f, startLocal: e.target.value })} className={field} /></label>
      <label className="block text-sm font-semibold">Round<input value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} className={field} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-semibold">Mode<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className={field}><option>Video</option><option>Phone</option><option>In person</option></select></label>
        <label className="block text-sm font-semibold">Minutes<input type="number" inputMode="numeric" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} className={field} /></label>
      </div>
      <label className="block text-sm font-semibold">Meeting link or address<input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">For video, leave empty to use the connected calendar, if there is one.</span></label>
      <fieldset>
        <legend className="text-sm font-semibold">Interviewers ({panel.length} chosen)</legend>
        <input aria-label="Find an interviewer" placeholder="Find a person" value={find} onChange={(e) => setFind(e.target.value)} className={field} />
        <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200">
          {staff.filter((u) => panel.includes(u.id) || u.name.toLowerCase().includes(find.toLowerCase())).map((u) => (
            <label key={u.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-0"><input type="checkbox" className="h-5 w-5 accent-[#4C3EB0]" checked={panel.includes(u.id)} onChange={(e) => setPanel(e.target.checked ? [...panel, u.id] : panel.filter((x) => x !== u.id))} />{u.name}</label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-slate-500">The candidate and interviewers are emailed the schedule and calendar invite.</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {clash && <button type="button" disabled={busy} className={outline} onClick={() => send(true)}>Schedule anyway</button>}
      <div className="grid grid-cols-2 gap-2"><button type="button" className={outline} onClick={onCancel}>Cancel</button><button type="button" disabled={busy || !f.startLocal || !panel.length} className={solid} onClick={() => send(false)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send invites</button></div>
    </div>
  );
};

const Candidate: React.FC<{ id: string; users: User[]; onBack: () => void }> = ({ id, users, onBack }) => {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [done, setDone] = useState('');
  const load = useCallback(() => pipelineService.candidate(id).then(setD).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const a = d?.application;
  const fact = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 py-1.5 text-sm"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold text-slate-900">{v}</dd></div>;
  return (
    <div className="space-y-3">
      <Back onClick={onBack} />
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!d && !error && <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />}
      {a && (
        <>
          <section className={card}>
            <h2 className="text-lg font-extrabold text-slate-900">{a.name}</h2>
            <p className="text-sm text-slate-600">{a.designation} · {a.status}</p>
            {a.tags?.length > 0 && <p className="mt-1 text-xs font-bold text-[#3F3393]">{a.tags.join(' · ')}</p>}
            <dl className="mt-3 divide-y divide-slate-100">
              {d.score && fact('Resume score', <>{d.score.earned} of 100{d.score.complete ? '' : ' so far'}</>)}
              {fact('Experience', d.years || d.years === 0 ? `${d.years} years` : a.experience || 'Not given')}
              {fact('Expected salary', a.expectedCtcLpa ? `₹${a.expectedCtcLpa} lakhs` : 'Not given')}
              {fact('Test', (d.assessments || []).length ? (d.assessments as any[]).map((x) => (x.result ? `${x.title}: ${x.result === 'PASS' ? 'passed' : 'not passed'}` : `${x.title}: waiting`)).join(', ') : 'None')}
            </dl>
            <p className="mt-2 text-xs text-slate-500">The score is a guide. A person makes the decision.</p>
          </section>
          {/^(https:\/\/|\/api\/)/.test(a.resumeUrl || '') && <a href={a.resumeUrl} target="_blank" rel="noopener noreferrer" className={outline}>View resume</a>}
          {done && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>}
          {a.status !== 'Rejected' && (scheduling
            ? <Schedule applicationId={id} users={users} onCancel={() => setScheduling(false)} onDone={() => { setScheduling(false); setDone('Interview scheduled.'); void load(); }} />
            : <button type="button" className={solid} onClick={() => { setScheduling(true); setDone(''); }}>Schedule interview</button>)}
        </>
      )}
    </div>
  );
};

const Candidates: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { pipelineService.board().then((r: any) => setRows(r.rows || [])).catch((e: Error) => { setError(e.message); setRows([]); }); }, []);
  const shown = (rows || []).filter((r) => r.status !== 'Rejected' && (!q || `${r.name} ${r.designation}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <section>
      <h2 className="text-base font-extrabold text-slate-900">Candidates</h2>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-[60%] h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input aria-label="Search candidates" placeholder="Search name or role" value={q} onChange={(e) => setQ(e.target.value)} className={`${field} !pl-9`} /></div>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      {!rows ? <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-slate-400" /> : (
        <ul className="mt-2 space-y-2">
          {shown.slice(0, 30).map((r) => <li key={r.id}><button type="button" onClick={() => onOpen(r.id)} className={`${card} flex w-full items-center gap-3 text-left`}><span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-900">{r.name}</span><span className="block truncate text-sm text-slate-500">{r.designation} · {r.status}</span></span><ChevronRight className="h-4 w-4 text-slate-400" /></button></li>)}
          {shown.length === 0 && !error && <li className="py-6 text-center text-sm text-slate-500">No candidates found.</li>}
          {shown.length > 30 && <li className="text-center text-xs text-slate-500">Showing the newest 30. Search to find others.</li>}
        </ul>
      )}
    </section>
  );
};

export const RecruiterView: React.FC<{ work: HiringWork; users: User[] }> = ({ work, users }) => {
  const [candidate, setCandidate] = useState('');
  const [interview, setInterview] = useState<any>(null);
  if (candidate) return <Candidate id={candidate} users={users} onBack={() => setCandidate('')} />;
  if (interview) return (
    <div className="space-y-3">
      <Back onClick={() => { setInterview(null); void work.reload(); }} />
      <div className={card}><h2 className="text-lg font-extrabold text-slate-900">{interview.candidateName}</h2><p className="mb-3 text-sm text-slate-600">{interview.round} · {when(interview.startIso)}</p><FeedbackPanel interviewId={interview.id} manager={false} onChanged={() => { void work.reload(); }} /></div>
    </div>
  );
  const nothing = !work.feedback.length && !work.offers.length && !work.tasks.length;
  const soon = work.interviews.filter((i) => i.status === 'SCHEDULED' && Date.parse(i.startIso) > Date.now()).slice(0, 5);
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-base font-extrabold text-slate-900">Needs you</h2>
        {work.error && <p role="alert" className="mb-2 text-sm text-rose-700">{work.error}</p>}
        {work.loading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : nothing ? <p className="text-sm text-slate-500">Nothing is waiting for you.</p> : (
          <ul className="space-y-3">
            {work.feedback.map((i) => <li key={i.id} className={card}><p className="text-xs font-bold uppercase text-slate-500">Interview feedback</p><p className="mt-1 font-bold text-slate-900">{i.candidateName}</p><p className="text-sm text-slate-600">{i.round} · {when(i.startIso)}</p><button type="button" className={`${solid} mt-3`} onClick={() => setInterview(i)}>Add feedback</button></li>)}
            {work.offers.map((o) => <OfferCard key={o.id} o={o} onDone={work.reload} />)}
            {work.tasks.map((t) => <TaskCard key={t.id} t={t} onDone={work.reload} />)}
          </ul>
        )}
      </section>
      {soon.length > 0 && <section><h2 className="mb-2 text-base font-extrabold text-slate-900">Coming interviews</h2><ul className="space-y-2">{soon.map((i) => <li key={i.id} className={card}><p className="font-bold text-slate-900">{i.candidateName}</p><p className="text-sm text-slate-600">{i.round} · {when(i.startIso)}</p>{/^https?:\/\//i.test(i.location || '') && <a className="mt-1 inline-block text-sm font-bold text-[#3F3393] underline" href={i.location} target="_blank" rel="noreferrer">Meeting link</a>}</li>)}</ul></section>}
      {work.talent && <Candidates onOpen={setCandidate} />}
    </div>
  );
};
