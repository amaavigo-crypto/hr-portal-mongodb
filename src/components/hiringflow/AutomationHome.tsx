import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Search } from 'lucide-react';
import { flowService, type FamilyView } from '../../services/flowService';
import { STEP_INFO, STEP_ORDER, type FlowStep } from '../../../shared/flowEngine';
import { Loading, useLoad } from '../common/loadUi';
import { whenIst } from './when';

const Steps: React.FC<{ steps?: FlowStep[] }> = ({ steps }) => {
  if (!steps?.length) return <span className="text-[#5c626d]">No steps yet</span>;
  const names = steps.map((s) => s.title || STEP_INFO[s.type]?.label || s.type);
  return (
    <span className="flex items-center gap-2" title={names.join(' → ')}>
      <span className="flex items-center" aria-hidden>
        {steps.slice(0, 8).map((s, i) => <React.Fragment key={s.id}>{i > 0 && <span className="h-px w-2.5 bg-[#c9ccd2]" />}<span className="h-2 w-2 rounded-full bg-[#3d434d]" /></React.Fragment>)}
      </span>
      <span className="whitespace-nowrap text-xs text-[#5c626d]">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
    </span>
  );
};

const StatusPill: React.FC<{ f: FamilyView }> = ({ f }) => {
  const [text, cls] = f.active ? [`Live · v${f.active.version}`, 'bg-[#e7f6ee] text-[#05603a]'] : f.draft ? ['Draft', 'bg-[#fdf1dc] text-[#8a5300]'] : ['Not built', 'bg-[#f0f1f3] text-[#4b515c]'];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
};

interface Props { onOpenFlow: (familyId: string) => void; onCreate: (from: 'standard' | 'empty') => void; onShowStuck: () => void }

/** The list of hiring flows, with anything stuck called out first. */
export const AutomationHome: React.FC<Props> = ({ onOpenFlow, onCreate, onShowStuck }) => {
  const st = useLoad(() => flowService.state(), []);
  const runs = useLoad(() => flowService.runs(), []);
  const [q, setQ] = useState('');
  const families: FamilyView[] = (st.data as any)?.families || [];
  const items = runs.data?.items || [];
  const stuck = items.filter((r) => r.status === 'STUCK').length;
  const lastRun = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of items) if (!m.get(r.familyId) || r.updatedAt > m.get(r.familyId)!) m.set(r.familyId, r.updatedAt);
    return m;
  }, [items]);
  const rows = families.filter((f) => !q || `${f.name} ${f.designations.join(' ')}`.toLowerCase().includes(q.toLowerCase()));

  if (st.loading && !st.data) return <Loading loading />;
  if (st.error && !st.data) return <Loading error={st.error} />;

  return (
    <div className="space-y-6">
      {stuck > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-[#fdeceb] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-[#b42318]" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-[#16181d]"><b className="font-semibold">{stuck} applicant{stuck === 1 ? ' is' : 's are'} stuck.</b> They wait until someone in HR moves them on.</p>
          <button type="button" onClick={onShowStuck} className="h-8 cursor-pointer rounded-md border border-[#f3c1bc] bg-white px-3.5 text-[13px] font-semibold text-[#b42318]">Review</button>
        </div>
      )}
      {runs.error && <p className="text-sm text-rose-700" role="alert">Could not load applicant progress: {runs.error}</p>}

      <section>
        {families.length > 5 && <div className="relative mb-3 max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flows" aria-label="Search flows" className="h-9 w-full rounded-lg border border-[#dfe1e5] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#c2500a]" /></div>}
        {rows.length === 0 ? <p className="py-8 text-center text-sm text-[#5c626d]">{families.length ? 'No flows match.' : 'No flow yet. Start one below.'}</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-[#e8e9ec] text-xs text-[#5c626d]">{['Flow', 'Used for', 'Steps', 'In flow now', 'Status', 'Last activity', ''].map((h, i) => <th key={i} className="px-2 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.familyId} className="cursor-pointer border-b border-[#eef0f2] hover:bg-[#f8f8f9]" onClick={() => onOpenFlow(f.familyId)}>
                  <td className="px-2 py-4"><button type="button" onClick={(e) => { e.stopPropagation(); onOpenFlow(f.familyId); }} className="cursor-pointer text-left font-semibold text-[#16181d]">{f.name}</button>{f.draft && f.active && <span className="block text-xs text-[#8a5300]">Unpublished changes</span>}</td>
                  <td className="max-w-[15rem] truncate px-2 py-4 text-[#3d434d]" title={f.isDefault ? 'Every role without its own flow' : f.designations.join(', ')}>{f.isDefault ? 'All other roles' : f.designations.join(', ') || '—'}</td>
                  <td className="px-2 py-4"><Steps steps={(f.active || f.draft)?.steps} /></td>
                  <td className="px-2 py-4 tabular-nums">{f.inFlight}</td>
                  <td className="px-2 py-4"><StatusPill f={f} /></td>
                  <td className="px-2 py-4 text-[13px] text-[#5c626d]">{whenIst(lastRun.get(f.familyId))}</td>
                  <td className="px-2 py-4 text-right"><ChevronRight className="inline h-4 w-4 text-[#8a909b]" aria-hidden /></td>
                </tr>
              ))}
            </tbody></table></div>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold text-[#16181d]">Start a new flow</h2>
        <p className="mt-0.5 text-[13px] text-[#5c626d]">For roles that are hired differently from everyone else.</p>
        <div className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-2">
          {([['standard', 'Use the standard process', 'Score, phone screen, interview, offer and joining. Change any step.'], ['empty', 'Start with a blank flow', 'Add only the steps you want.']] as const).map(([k, title, text]) => (
            <button key={k} type="button" onClick={() => onCreate(k)} className="cursor-pointer rounded-[10px] border border-[#dfe1e5] p-4 text-left hover:border-[#c2500a]">
              <span className="block text-sm font-semibold text-[#16181d]">{title}</span>
              <span className="mt-1 block text-[13px] text-[#5c626d]">{text}</span>
            </button>
          ))}
        </div>
        <details className="mt-4 max-w-3xl">
          <summary className="cursor-pointer text-[13px] font-semibold text-[#3d434d]">Steps you can use in a flow</summary>
          <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
            {STEP_ORDER.map((t) => <li key={t} className="border-b border-[#eef0f2] py-2.5"><span className="block text-[13px] font-semibold text-[#16181d]">{STEP_INFO[t].label}</span><span className="block text-xs text-[#5c626d]">{STEP_INFO[t].does}</span></li>)}
          </ul>
        </details>
      </section>
    </div>
  );
};
