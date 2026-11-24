import React, { useState } from 'react';
import { User } from '../types';
import { hasPerm } from '../../shared/permissions';
import { Approvals } from './workplace/Approvals';
import { Assets } from './workplace/Assets';
import { CustomFields } from './workplace/CustomFields';
import { ESign } from './workplace/ESign';
import { Reports } from './workplace/Reports';
import { Surveys } from './workplace/Surveys';
import { Wall } from './workplace/Wall';

const TABS = [['wall', 'Social wall'], ['surveys', 'Surveys & feedback'], ['esign', 'E-sign'], ['assets', 'Assets'], ['approvals', 'Approvals'], ['reports', 'Reports'], ['fields', 'My details']] as const;
type Tab = (typeof TABS)[number][0];
const KEY = 'amaavigo_workplace_tab';

/** Everyday workplace tools: the social wall, surveys and feedback, documents to sign, and company assets. */
export const WorkplaceModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [tab, setTab] = useState<Tab>(() => { try { const v = localStorage.getItem(KEY) as Tab; return TABS.some(([k]) => k === v) ? v : 'wall'; } catch { return 'wall'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ } };
  const can = (p: string) => !!currentUser.isCompanyAdmin || hasPerm(currentUser.perms || [], p);
  const canAssets = !!currentUser.isCompanyAdmin || hasPerm(currentUser.perms || [], 'asset.manage');
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Workplace</h1>
          <p className="mt-1 text-sm text-slate-600">Posts and kudos, surveys, documents to sign, equipment, approvals, reports and your extra details.</p>
        </div>
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Workplace sections">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => pick(k)} className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold border ${tab === k ? 'bg-[#6d4cf0] text-white border-transparent' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        {tab === 'wall' && <Wall />}
        {tab === 'surveys' && <Surveys />}
        {tab === 'esign' && <ESign />}
        {tab === 'assets' && <Assets canManage={canAssets} />}
        {tab === 'approvals' && <Approvals canBuild={can('workflow.manage')} />}
        {tab === 'reports' && <Reports canBuild={can('report.manage')} />}
        {tab === 'fields' && <CustomFields canManage={can('custom.manage')} />}
      </div>
    </div>
  );
};
