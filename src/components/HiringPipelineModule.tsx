import React, { useState } from 'react';
import { User } from '../types';
import { Plus, RefreshCw, Settings } from 'lucide-react';
import { CandidateDrawer, CandidatesTab } from './hiring/CandidatesTab';
import { PERIODS, PipelineBoard, usePipelineData } from './hiring/PipelineBoard';
import { InterviewsTab } from './hiring/InterviewsTab';
import { ReferralsTab } from './hiring/ReferralsTab';
import { ScoringTab } from './hiring/ScoringTab';
import { OffersTab } from './hiring/OffersTab';
import { DashboardTab } from './hiring/DashboardTab';
import { AiTab } from './hiring/AiTab';
import { ApplicationsModule } from './ApplicationsModule';
import { Segmented } from './hiring/shell/Segmented';
import { TAB_KEY } from './hiring/shell/HiringHome';
import { hasAnyPerm } from '../../shared/permissions';

type Tab = 'pipeline' | 'candidates' | 'applications' | 'interviews' | 'offers' | 'referrals' | 'ai' | 'dashboard' | 'scoring';

interface Props {
  currentUser: User; users: User[];
  /** The applications screen is its own address, so links to it keep working. */
  showApplications?: boolean; onShowApplications?: (on: boolean) => void;
}

/** Everything about candidates: board, list, applications, interviews, offers, referrals, scoring and reports. */
export const HiringPipelineModule: React.FC<Props> = ({ currentUser, users, showApplications = false, onShowApplications }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const founder = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['req.founder_decide']);
  const seeDash = founder || hasAnyPerm(currentUser.perms, ['hrbp.view', 'hrbp.manage']);
  // A hiring task can open a specific view here (candidates, interviews, offers).
  const [own, setOwn] = useState<Exclude<Tab, 'applications'>>(() => {
    try { const t = sessionStorage.getItem(TAB_KEY); sessionStorage.removeItem(TAB_KEY); if (t && ['candidates', 'interviews', 'offers'].includes(t)) return t as 'candidates'; } catch { /* first view */ }
    return 'pipeline';
  });
  const tab: Tab = showApplications ? 'applications' : own;
  const go = (t: Tab) => {
    if (t === 'applications') { onShowApplications?.(true); return; }
    setOwn(t);
    if (showApplications) onShowApplications?.(false);
  };
  const [days, setDays] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);
  const data = usePipelineData(days, refreshKey);
  const views: { value: Tab; label: string }[] = [
    { value: 'pipeline', label: 'Board' }, { value: 'candidates', label: 'List' }, { value: 'applications', label: 'Applications' },
    { value: 'interviews', label: 'Interviews' }, { value: 'offers', label: 'Offers' }, { value: 'referrals', label: 'Referrals' },
    { value: 'ai', label: 'AI & duplicates' }, ...(seeDash ? [{ value: 'dashboard' as Tab, label: 'Analytics' }] : []),
  ];
  const iconButton = 'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#dfe1e5] bg-white text-[#3d434d] hover:border-[#c2500a]';
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-8">
        <Segmented label="Candidate views" value={tab} onChange={go} options={views} />
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'pipeline' && <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-9 rounded-lg border border-[#dfe1e5] bg-white px-3 text-[13px] text-[#16181d] outline-none focus:border-[#c2500a]">{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select>}
          <button type="button" onClick={() => setRefreshKey((n) => n + 1)} aria-label="Refresh" title="Refresh" className={iconButton}><RefreshCw className="h-4 w-4" /></button>
          <button type="button" onClick={() => go('scoring')} aria-label="Scoring settings" title="Scoring settings" aria-pressed={tab === 'scoring'} className={`${iconButton} ${tab === 'scoring' ? '!border-[#c2500a]' : ''}`}><Settings className="h-4 w-4" /></button>
          {tab !== 'applications' && <button type="button" onClick={() => go('applications')} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-[#c2500a] px-4 text-[13px] font-semibold text-white hover:bg-[#a84308]"><Plus className="h-4 w-4" />Add candidate</button>}
        </div>
      </div>
      <div key={refreshKey} className={tab === 'applications' ? 'flex flex-col' : 'space-y-4 px-4 py-4 sm:px-8'}>
        {tab === 'pipeline' && <PipelineBoard d={data} onOpenCandidate={setOpenId} />}
        {tab === 'candidates' && <CandidatesTab users={users} />}
        {tab === 'applications' && <ApplicationsModule currentUser={currentUser} />}
        {tab === 'interviews' && <InterviewsTab />}
        {tab === 'referrals' && <ReferralsTab />}
        {tab === 'scoring' && <ScoringTab />}
        {tab === 'offers' && <OffersTab canApprove={founder} />}
        {tab === 'ai' && <AiTab />}
        {tab === 'dashboard' && seeDash && <DashboardTab />}
      </div>
      {openId && <CandidateDrawer id={openId} users={users} onClose={() => setOpenId(null)} onChanged={data.reload} />}
    </div>
  );
};
