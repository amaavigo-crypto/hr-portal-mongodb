/**
 * The one "Hiring" section: which tabs a person sees and which screen each one opens.
 * Every screen keeps its old module id, so task links, Home cards and access checks work as before.
 * Pure TypeScript so it can be tested without a browser.
 */
export type HiringModuleId =
  | 'talent-hiring' | 'talent-acquisition' | 'talent-acquisition-overview' | 'my-hiring'
  | 'talent-acquisition-requisitions' | 'talent-acquisition-applications' | 'talent-acquisition-pipeline'
  | 'talent-acquisition-onboarding' | 'hiring-automation';

export interface HiringAccess {
  /** Has the Talent Acquisition module. */
  talent: boolean;
  /** May raise hiring requests (a department head without the full module). */
  canRequest: boolean;
  /** May build hiring flows and fix stuck applicants. */
  manageFlows: boolean;
}

export type HiringTabKey = 'home' | 'jobs' | 'candidates' | 'onboarding' | 'automation';
export interface HiringPage { module: HiringModuleId; label: string }
export interface HiringTab { key: HiringTabKey; label: string; pages: HiringPage[] }

export const FLOW_MANAGE_PERMS = ['app.manage', 'req.manage_jd', 'req.hr_decide'];

export const isHiringModule = (m: string): m is HiringModuleId =>
  m === 'talent-hiring' || m === 'my-hiring' || m === 'hiring-automation' || m === 'talent-acquisition' || m.startsWith('talent-acquisition-');

export function hiringTabs(a: HiringAccess): HiringTab[] {
  const tabs: HiringTab[] = [
    {
      key: 'home', label: 'Home', pages: [
        { module: 'talent-hiring', label: 'Needs you' },
        ...(a.talent ? [{ module: 'talent-acquisition-overview' as const, label: 'Reports' }] : []),
        { module: 'my-hiring', label: 'Referrals & interviews' },
      ],
    },
    { key: 'jobs', label: 'Jobs', pages: a.talent || a.canRequest ? [{ module: 'talent-acquisition-requisitions', label: a.talent ? 'Requisitions' : 'Hiring requests' }] : [] },
    // Applications is a view inside the candidate screen, next to the board and list.
    { key: 'candidates', label: 'Candidates', pages: a.talent ? [{ module: 'talent-acquisition-pipeline', label: 'Candidates' }] : [] },
    { key: 'onboarding', label: 'Onboarding', pages: a.talent ? [{ module: 'talent-acquisition-onboarding', label: 'Onboarding' }] : [] },
    { key: 'automation', label: 'Automation', pages: a.manageFlows ? [{ module: 'hiring-automation', label: 'Automation' }] : [] },
  ];
  return tabs.filter((t) => t.pages.length > 0);
}

/** The tab a screen belongs to. */
export function tabOfModule(m: string): HiringTabKey {
  if (m === 'talent-acquisition-requisitions') return 'jobs';
  if (m === 'talent-acquisition-pipeline' || m === 'talent-acquisition-applications') return 'candidates';
  if (m === 'talent-acquisition-onboarding') return 'onboarding';
  if (m === 'hiring-automation') return 'automation';
  return 'home';
}

export function hiringPageLabel(m: string): string {
  const all = hiringTabs({ talent: true, canRequest: true, manageFlows: true });
  const tab = all.find((t) => t.key === tabOfModule(m))!;
  const page = tab.pages.find((p) => p.module === (m === 'talent-acquisition' ? 'talent-acquisition-overview' : m));
  return page && tab.pages.length > 1 ? `${tab.label} · ${page.label}` : tab.label;
}
