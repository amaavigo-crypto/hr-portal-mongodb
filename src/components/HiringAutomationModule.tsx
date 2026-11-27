import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { User } from '../types';
import { flowService, type FlowState } from '../services/flowService';
import { flowNav, type FlowSection } from './hiringflow/flowNav';
import { AutomationHome } from './hiringflow/AutomationHome';
import { AutomationActivity } from './hiringflow/AutomationActivity';
import { FlowBuilder } from './hiringflow/FlowBuilder';
import { FlowRuns } from './hiringflow/FlowRuns';
import { Segmented } from './hiring/shell/Segmented';
import { FollowUps } from './hiringflow/FollowUps';
import { QuickRules } from './hiringflow/QuickRules';
import { ToastProvider } from './leave/ui';

export type NewFlowStart = 'standard' | 'empty';

/**
 * Hiring > Automation, for the people who manage hiring: build the flows and watch applicants move through them.
 * The tasks a flow creates are on Hiring Home.
 */
export const HiringAutomationModule: React.FC<{ currentUser: User }> = () => {
  const [flow, setFlow] = useState<FlowState | null>(null);
  const load = useCallback(() => { flowService.state().then((r) => setFlow(r as any)).catch(() => undefined); }, []);
  useEffect(load, [load]);
  const section = flowNav.useNav().section as FlowSection;

  // Opening a flow (or starting a new one) from the list lands in the flow builder.
  const [target, setTarget] = useState<{ id: string | null; adding: boolean; from: NewFlowStart; n: number }>({ id: null, adding: false, from: 'standard', n: 0 });
  const toBuilder = (id: string | null, adding: boolean, from: NewFlowStart = 'standard') => { setTarget((t) => ({ id, adding, from, n: t.n + 1 })); flowNav.setSection('flow'); };
  // After a reload there is no chosen flow, so the builder gives way to the list.
  const view: FlowSection = section === 'flow' && target.n === 0 ? 'workflows' : section;
  const toList = () => { load(); flowNav.setSection('workflows'); };

  return (
    <ToastProvider>
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-4 pb-10 pt-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<FlowSection> label="Automation views" value={view === 'flow' ? 'workflows' : view} onChange={(v) => flowNav.setSection(v)} options={[
            { value: 'workflows', label: 'Flows' }, { value: 'rules', label: 'Quick rules' }, { value: 'followups', label: 'Follow-ups' }, { value: 'runs', label: 'Applicant progress', badge: flow?.counts?.STUCK }, { value: 'activity', label: 'Activity' },
          ]} />
          {view === 'workflows' && <button type="button" onClick={() => toBuilder(null, true)} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-[#4C3EB0] px-4 text-[13px] font-semibold text-white hover:bg-[#3F3393]"><Plus className="h-4 w-4" />New flow</button>}
        </div>
        {view === 'workflows' && <AutomationHome onOpenFlow={(id) => toBuilder(id, false)} onCreate={(from) => toBuilder(null, true, from)} onShowStuck={() => flowNav.setSection('runs')} />}
        {view === 'flow' && <FlowBuilder key={target.n} onChanged={load} initialFamilyId={target.id} startAdding={target.adding} startFrom={target.from} onBack={toList} />}
        {view === 'rules' && <QuickRules />}
        {view === 'followups' && <FollowUps onShowActivity={() => flowNav.setSection('activity')} />}
        {view === 'runs' && <FlowRuns people={flow?.people || []} onChanged={load} />}
        {view === 'activity' && <AutomationActivity />}
      </div>
    </ToastProvider>
  );
};
