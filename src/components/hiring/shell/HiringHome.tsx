import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { User, Requisition } from '../../../types';
import { subscribeToRequisitions } from '../../../services/requisitionService';
import { pipelineService } from '../../../services/pipelineService';
import { flowService } from '../../../services/flowService';
import { can, needsMyAction } from '../../../utils/requisitionPermissions';
import { useLoad } from '../../common/loadUi';
import { ToastProvider } from '../../leave/ui';
import { FlowTasks } from '../../hiringflow/FlowTasks';
import { flowNav } from '../../hiringflow/flowNav';
import { stageOf, STAGES } from '../PipelineBoard';
import { upcomingInterviews, awaitingMyFeedback } from './homeData';
import type { HiringAccess, HiringModuleId } from './hiringNav';

const at = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** Where a task's "Open ..." button lands. */
export const TAB_KEY = 'amaavigo_hiring_open_tab';

const Stat: React.FC<{ label: string; value: number | string; hint?: string; onClick: () => void }> = ({ label, value, hint, onClick }) => (
  <button type="button" onClick={onClick} className="cursor-pointer border-[#e8e9ec] py-1 pr-6 text-left sm:border-l sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
    <span className="block text-[13px] text-[#5c626d]">{label}</span>
    <span className="mt-1.5 block text-[30px] font-semibold leading-none tracking-tight tabular-nums text-[#16181d]">{value}</span>
    <span className="mt-1.5 block min-h-4 text-xs text-[#5c626d]">{hint}</span>
  </button>
);

const Row: React.FC<{ title: string; detail: string; action: string; onClick: () => void }> = ({ title, detail, action, onClick }) => (
  <li className="flex items-center gap-4 border-b border-[#eef0f2] py-3.5">
    <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[#16181d]">{title}</div><div className="mt-0.5 truncate text-[13px] text-[#5c626d]">{detail}</div></div>
    <button type="button" onClick={onClick} className="h-8 shrink-0 cursor-pointer rounded-md border border-[#dfe1e5] px-3.5 text-[13px] font-semibold text-[#16181d] hover:border-[#c2500a]">{action}</button>
  </li>
);

const HomeBody: React.FC<{ currentUser: User; access: HiringAccess; onNavigate: (m: HiringModuleId) => void }> = ({ currentUser, access, onNavigate }) => {
  const [reqs, setReqs] = useState<Requisition[] | null>(null);
  const seeJobs = access.talent || access.canRequest;
  useEffect(() => {
    if (!seeJobs) return undefined;
    try { return subscribeToRequisitions(setReqs); } catch { return undefined; }
  }, [seeJobs]);
  const board = useLoad(() => (access.talent ? pipelineService.board() : Promise.resolve(null)), [access.talent]);
  const interviews = useLoad(() => pipelineService.interviews(), []);
  const flow = useLoad(() => (access.manageFlows ? flowService.state() : Promise.resolve(null)), [access.manageFlows]);

  const openTab = (tab: string) => {
    try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* the screen opens on its first view */ }
    if (tab === 'interviews' && !access.manageFlows) onNavigate('my-hiring');
    else if (!access.talent) onNavigate('my-hiring');
    else onNavigate(tab === 'joining' ? 'talent-acquisition-onboarding' : 'talent-acquisition-pipeline');
  };

  const rows: any[] | null = (board.data as any)?.rows || null;
  const inStage = (i: number) => (rows || []).filter((r) => stageOf(r.status) === i).length;
  const active = rows ? rows.filter((r) => { const s = stageOf(r.status); return s !== null && s < 4; }).length : null;
  const visibleReqs = (reqs || []).filter((r) => can(currentUser, 'view', r));
  const myReqs = visibleReqs.filter((r) => needsMyAction(currentUser, r));
  const items: any[] = (interviews.data as any)?.items || [];
  const upcoming = upcomingInterviews(items, Date.now());
  const feedback = awaitingMyFeedback(items, Date.now());
  const stuck = (flow.data as any)?.counts?.STUCK || 0;
  const max = Math.max(1, ...STAGES.map((_, i) => inStage(i)));
  const dash = '—';

  return (
    <div className="px-4 pb-10 pt-6 sm:px-8">
      <section aria-label="Summary" className="grid grid-cols-2 gap-y-5 border-b border-[#e8e9ec] pb-6 sm:grid-cols-4">
        {seeJobs && <Stat label="Open roles" value={reqs ? visibleReqs.filter((r) => r.status === 'JOB_OPEN').length : dash} hint={myReqs.length ? `${myReqs.length} need${myReqs.length === 1 ? 's' : ''} your action` : ''} onClick={() => onNavigate('talent-acquisition-requisitions')} />}
        {access.talent && <Stat label="Active candidates" value={active ?? dash} hint={board.error ? 'Could not load' : ''} onClick={() => onNavigate('talent-acquisition-pipeline')} />}
        <Stat label="Interviews" value={interviews.data ? upcoming.length : dash} hint={interviews.error ? 'Could not load' : 'Next 7 days'} onClick={() => onNavigate('my-hiring')} />
        {access.talent && <Stat label="At offer stage" value={rows ? inStage(3) : dash} onClick={() => openTab('offers')} />}
      </section>

      <div className="mt-7 flex flex-wrap gap-x-12 gap-y-8">
        <div className="min-w-0 flex-[999_1_460px] space-y-8">
          {(feedback.length > 0 || myReqs.length > 0) && (
            <section>
              <h2 className="text-base font-semibold text-[#16181d]">Waiting on you</h2>
              <ul>
                {feedback.map((i) => <Row key={i.id} title="Give interview feedback" detail={`${i.candidateName} · ${i.round}`} action="Add feedback" onClick={() => { try { sessionStorage.setItem(TAB_KEY, 'interviews'); } catch { /* first view */ } onNavigate('my-hiring'); }} />)}
                {myReqs.slice(0, 5).map((r) => <Row key={r.id} title="Hiring request needs you" detail={`${r.positionTitle} · ${r.departmentName}`} action="Review" onClick={() => onNavigate('talent-acquisition-requisitions')} />)}
              </ul>
            </section>
          )}
          <section><FlowTasks onOpenTab={openTab} onChanged={() => { flow.reload(); board.reload(); }} /></section>
          {access.talent && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#16181d]">Pipeline</h2>
                <button type="button" onClick={() => onNavigate('talent-acquisition-pipeline')} className="cursor-pointer text-[13px] font-semibold text-[#a84308] hover:underline">View candidates</button>
              </div>
              {board.error ? <p className="text-sm text-rose-700" role="alert">{board.error}</p> : STAGES.map((s, i) => (
                <div key={s} className="grid grid-cols-[96px_minmax(0,1fr)_36px] items-center gap-3 py-1.5 text-[13px]">
                  <span className="text-[#555b66]">{s}</span>
                  <span className="h-1.5 rounded bg-[#eef0f2]"><span className="block h-1.5 rounded bg-[#3d434d]" style={{ width: `${(inStage(i) / max) * 100}%` }} /></span>
                  <b className="text-right font-semibold tabular-nums">{rows ? inStage(i) : dash}</b>
                </div>
              ))}
            </section>
          )}
        </div>
        <aside className="min-w-0 flex-[1_1_260px] space-y-8">
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#16181d]">Upcoming interviews</h2>
              <button type="button" aria-label="Refresh interviews" onClick={() => { interviews.reload(); board.reload(); flow.reload(); }} className="cursor-pointer rounded-md p-1.5 text-[#5c626d] hover:bg-[#f1f2f4]"><RefreshCw className="h-4 w-4" /></button>
            </div>
            {interviews.error ? <p className="mt-2 text-sm text-rose-700" role="alert">{interviews.error}</p>
              : upcoming.length === 0 ? <p className="mt-2 text-[13px] text-[#5c626d]">{interviews.loading ? 'Loading…' : 'No interviews in the next 7 days.'}</p>
              : <ul>{upcoming.slice(0, 6).map((i) => (
                <li key={i.id} className="border-b border-[#eef0f2] py-3">
                  <div className="text-sm font-medium text-[#16181d]">{i.candidateName}</div>
                  <div className="mt-0.5 text-xs text-[#5c626d]">{at(i.startIso)} · {i.round}</div>
                </li>))}</ul>}
          </section>
          {stuck > 0 && (
            <section className="rounded-[10px] bg-[#fdeceb] p-4">
              <h2 className="text-sm font-semibold text-[#16181d]">{stuck} applicant{stuck === 1 ? ' is' : 's are'} stuck</h2>
              <p className="mt-1 text-[13px] text-[#7a271a]">The hiring flow needs HR to move them on.</p>
              <button type="button" onClick={() => { flowNav.setSection('runs'); onNavigate('hiring-automation'); }} className="mt-3 h-8 cursor-pointer rounded-md border border-[#f3c1bc] bg-white px-3.5 text-[13px] font-semibold text-[#b42318]">Review</button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

/** Hiring Home: what is waiting for this person, and how hiring is going. */
export const HiringHome: React.FC<React.ComponentProps<typeof HomeBody>> = (p) => <ToastProvider><HomeBody {...p} /></ToastProvider>;
