import React from 'react';
import { CalendarCheck, FileCheck2, FileText, Briefcase, ListChecks, Users } from 'lucide-react';
import type { DashboardWidget, WidgetTarget } from '../../../shared/dashboard';
import { Card } from '../leave/ui';

interface TaskRow { key: string; text: string; count: number; target?: WidgetTarget; Icon: React.FC<{ className?: string }> }

/** One row per thing waiting on this person, built from the dashboard widgets (counts are real). */
const TAGS: Record<string, [string, string]> = {
  ap: ['Leave', 'bg-amber-100 text-amber-800'], rq: ['Documents', 'bg-violet-100 text-violet-700'], mr: ['Documents', 'bg-violet-100 text-violet-700'],
  rr: ['Documents', 'bg-violet-100 text-violet-700'], ak: ['Policies', 'bg-violet-100 text-violet-700'], mt: ['General', 'bg-slate-100 text-slate-700'],
  pt: ['People', 'bg-emerald-100 text-emerald-700'],
};
const tagFor = (key: string): [string, string] => TAGS[key] || (key.startsWith('h-') ? ['Hiring', 'bg-sky-100 text-sky-700'] : ['General', 'bg-slate-100 text-slate-700']);

/** Everything waiting on this person, one row per kind of work. Shared by the My Tasks card and the "Waiting on you" tile so their numbers always agree. */
export const taskRows = (widgets: DashboardWidget[]): TaskRow[] => {
  const rows: TaskRow[] = [];
  const d = (id: string) => widgets.find((w) => w.id === id);
  const num = (n: any) => (typeof n === 'number' ? n : 0);
  const a = d('approvals'); if (a && num((a.data as any).leave) > 0) rows.push({ key: 'ap', count: num((a.data as any).leave), text: `Review leave requests (${(a.data as any).leave})${num((a.data as any).overdue) > 0 ? `, ${(a.data as any).overdue} waiting too long` : ''}`, target: a.target, Icon: CalendarCheck });
  const rq = d('review-queue'); if (rq && num((rq.data as any).count) > 0) rows.push({ key: 'rq', count: num((rq.data as any).count), text: `Review documents (${(rq.data as any).count})`, target: rq.target, Icon: FileText });
  const mr = d('my-revisions'); if (mr && num((mr.data as any).count) > 0) rows.push({ key: 'mr', count: num((mr.data as any).count), text: `Fix documents sent back (${(mr.data as any).count})`, target: mr.target, Icon: FileText });
  const rr = d('rereview-due'); if (rr && num((rr.data as any).count) > 0) rows.push({ key: 'rr', count: num((rr.data as any).count), text: `Documents due for re-review (${(rr.data as any).count})`, target: rr.target, Icon: FileText });
  const ak = d('acknowledgements'); if (ak && num((ak.data as any).count) > 0) rows.push({ key: 'ak', count: num((ak.data as any).count), text: `Acknowledge policies (${(ak.data as any).count})`, target: ak.target, Icon: FileCheck2 });
  const mt = d('my-tasks'); if (mt && num((mt.data as any).openTasks) > 0) rows.push({ key: 'mt', count: num((mt.data as any).openTasks), text: `Finish your tasks (${(mt.data as any).openTasks})`, target: mt.target, Icon: ListChecks });
  const h = d('hiring'); if (h) for (const w of ((h.data as any).waiting || []) as { label: string; count: number }[]) rows.push({ key: `h-${w.label}`, count: num(w.count), text: `${w.label} (${w.count})`, target: h.target, Icon: Briefcase });
  const pt = d('people-tasks'); if (pt && num((pt.data as any).open) > 0) rows.push({ key: 'pt', count: num((pt.data as any).open), text: `Onboarding and exit tasks (${(pt.data as any).open})`, target: pt.target, Icon: Users });
  return rows;
};

export const MyTasks: React.FC<{ widgets: DashboardWidget[]; onOpen: (t: WidgetTarget) => void }> = ({ widgets, onOpen }) => {
  const rows = taskRows(widgets);
  return (
    <div id="home-my-tasks"><Card className="min-w-0" title={`My Tasks${rows.length ? ` (${rows.length})` : ''}`}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">You are all caught up. Nothing needs you right now.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" disabled={!r.target} onClick={() => r.target && onOpen(r.target)} className="w-full flex items-center gap-3 py-1.5 text-left rounded-lg hover:bg-orange-50/60 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default px-1">
                <span className="w-7 h-7 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><r.Icon className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-800">{r.text}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagFor(r.key)[1]}`}>{tagFor(r.key)[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card></div>
  );
};
