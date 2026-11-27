import React from 'react';
import { ArrowUpRight, BriefcaseBusiness, ClipboardList, Workflow, Users, UserPlus, Sparkles } from 'lucide-react';

type Destination =
  | 'talent-acquisition-overview'
  | 'talent-acquisition-requisitions'
  | 'talent-acquisition-applications'
  | 'talent-acquisition-pipeline'
  | 'talent-acquisition-onboarding'
  | 'hiring-automation'
  | 'my-hiring';

interface Props {
  hasTalentAccess: boolean;
  canCreateRequest: boolean;
  onNavigate: (module: Destination) => void;
}

const cards = [
  { eyebrow: 'At a glance', title: 'Recruitment overview', description: 'Review hiring activity and jump to the work that needs attention.', icon: BriefcaseBusiness, target: 'talent-acquisition-overview', tone: 'orange' },
  { eyebrow: 'Plan', title: 'Requisitions', description: 'Create, review, approve, and manage open hiring requests.', icon: ClipboardList, target: 'talent-acquisition-requisitions', tone: 'violet' },
  { eyebrow: 'Attract', title: 'Applications', description: 'Bring candidate applications together and manage incoming profiles.', icon: UserPlus, target: 'talent-acquisition-applications', tone: 'blue' },
  { eyebrow: 'Evaluate', title: 'Hiring pipeline', description: 'Track candidates through screening, assessments, and interviews.', icon: Users, target: 'talent-acquisition-pipeline', tone: 'green' },
  { eyebrow: 'Welcome', title: 'Onboarding', description: 'Coordinate the next steps after a candidate is selected.', icon: BriefcaseBusiness, target: 'talent-acquisition-onboarding', tone: 'orange' },
] as const;

const ActionCard: React.FC<{ item: { eyebrow: string; title: string; description: string; icon: React.ElementType; tone: string }; onClick: () => void }> = ({ item, onClick }) => {
  const Icon = item.icon;
  const tone = item.tone === 'violet' ? 'bg-violet-50 text-violet-700' : item.tone === 'blue' ? 'bg-blue-50 text-blue-700' : item.tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700';
  return (
    <button type="button" onClick={onClick} className="group flex min-h-[158px] w-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-400/40">
      <div className="flex w-full items-start justify-between">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>
        <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-orange-600" />
      </div>
      <span className="mt-5 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{item.eyebrow}</span>
      <span className="mt-1 text-[15px] font-semibold tracking-tight text-slate-900">{item.title}</span>
      <span className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500">{item.description}</span>
    </button>
  );
};

export const TalentHiringWorkspace: React.FC<Props> = ({ hasTalentAccess, canCreateRequest, onNavigate }) => (
  <div className="min-h-full bg-[#f7f8fa] px-4 py-7 sm:px-7 lg:px-10 lg:py-9">
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400"><span>Workspace</span><span>/</span><span className="text-slate-600">Talent &amp; Hiring</span></div>
      <section className="relative mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8">
        <div className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-orange-100/60 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-orange-700"><Sparkles className="h-3.5 w-3.5" /> Hiring workspace</div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-.045em] text-slate-950 sm:text-[40px]">Talent &amp; Hiring</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">One place to manage the hiring journey — from raising a role and reviewing candidates to coordinating interviews, onboarding, and the workflows that keep everything moving.</p>
        </div>
      </section>

      {hasTalentAccess && <section className="mt-9">
        <div className="mb-4"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-600">01 / Recruitment</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Manage the hiring journey</h2><p className="mt-1 text-xs text-slate-500">The core recruitment tools, connected in one workspace.</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((item) => <ActionCard key={item.target} item={item} onClick={() => onNavigate(item.target)} />)}
        </div>
      </section>}

      {canCreateRequest && !hasTalentAccess && <section className="mt-9">
        <div className="mb-4"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-600">01 / Recruitment</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Start a hiring request</h2></div>
        <div className="max-w-md"><ActionCard item={{ eyebrow: 'Request a role', title: 'Hiring requests', description: 'Submit a request for a new role and follow its approval process.', icon: ClipboardList, tone: 'orange' }} onClick={() => onNavigate('talent-acquisition-requisitions')} /></div>
      </section>}

      <section className="mt-9">
        <div className="mb-4"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">02 / Coordination</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Keep people and processes moving</h2><p className="mt-1 text-xs text-slate-500">The operational layer that supports each hiring step.</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ActionCard item={{ eyebrow: 'Automation', title: 'Hiring workflows', description: 'Open workflow automation, task assignments, and hiring process activity.', icon: Workflow, tone: 'violet' }} onClick={() => onNavigate('hiring-automation')} />
          <ActionCard item={{ eyebrow: 'Your activity', title: 'Referrals & interviews', description: 'Manage candidate referrals and interviews or feedback assigned to you.', icon: Users, tone: 'blue' }} onClick={() => onNavigate('my-hiring')} />
        </div>
      </section>
      <p className="mt-8 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-400">Your access determines which recruitment tools are available. Existing hiring workflows and permissions remain unchanged.</p>
    </div>
  </div>
);
