import React from 'react';
import { hiringTabs, tabOfModule, type HiringAccess, type HiringModuleId } from './hiringNav';
import { Segmented } from './Segmented';
import './hiring.css';

/** The shared frame of every hiring screen: one title, one row of tabs, and the open screen underneath. */
export const HiringShell: React.FC<{ active: string; access: HiringAccess; onNavigate: (m: HiringModuleId) => void; children: React.ReactNode }> = ({ active, access, onNavigate, children }) => {
  const tabs = hiringTabs(access);
  const current = active === 'talent-acquisition' ? 'talent-acquisition-overview' : active;
  const openTab = tabs.find((t) => t.key === tabOfModule(active));
  // Home and Candidates are drawn at their real size; the older screens keep the compact scale they were designed for.
  const compact = active !== 'talent-hiring' && active !== 'talent-acquisition-pipeline';
  return (
    <div className="hx flex min-h-full w-full min-w-0 flex-1 flex-col bg-white">
      <header className="border-b border-[#e8e9ec] px-4 pt-4 sm:px-8">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#16181d]">Hiring</h1>
        <nav className="-mb-px mt-2 flex gap-7 overflow-x-auto" aria-label="Hiring">
          {tabs.map((t) => {
            const on = t.key === openTab?.key;
            return (
              <button key={t.key} type="button" aria-current={on ? 'page' : undefined} onClick={() => onNavigate(t.pages[0].module)}
                className={`h-11 shrink-0 cursor-pointer whitespace-nowrap border-b-2 text-sm transition-colors ${on ? 'border-[#4C3EB0] font-semibold text-[#16181d]' : 'border-transparent font-medium text-[#5c626d] hover:text-[#16181d]'}`}>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>
      {openTab && openTab.pages.length > 1 && (
        <div className="px-4 pt-4 sm:px-8">
          <Segmented label={`${openTab.label} views`} value={current as HiringModuleId} onChange={onNavigate} options={openTab.pages.map((p) => ({ value: p.module, label: p.label }))} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col" style={compact ? { zoom: 0.9 } : undefined}>{children}</div>
    </div>
  );
};
