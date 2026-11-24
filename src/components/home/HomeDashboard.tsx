import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Card } from '../leave/ui';
import { inr, monthLabel } from '../../services/payrollService';
import type { DashboardWidget, WidgetId, WidgetTarget } from '../../../shared/dashboard';

const Count: React.FC<{ n: number; label: string; urgent?: boolean }> = ({ n, label, urgent }) => (
  <div>
    <div className={`text-3xl font-black tabular-nums ${urgent && n > 0 ? 'text-[#FA7014]' : 'text-slate-800'}`}>{n}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </div>
);

const DocList: React.FC<{ items: { documentId: string; title: string; versionNumber: string; overdue?: boolean }[]; count: number }> = ({ items, count }) => (
  <ul className="mt-3 space-y-1.5">
    {items.map((d) => (
      <li key={`${d.documentId}-${d.versionNumber}`} className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-slate-700">{d.title}</span>
        <span className="shrink-0 text-slate-400">v{d.versionNumber}{d.overdue ? ' · overdue' : ''}</span>
      </li>
    ))}
    {count > items.length && <li className="text-[11px] text-slate-400">and {count - items.length} more</li>}
  </ul>
);

/** One renderer per widget id. An id the browser does not know is skipped, so a newer server never breaks an older page. */
export const BODY: Partial<Record<WidgetId, (d: any) => React.ReactNode>> = {
  approvals: (d) => (
    <div className="flex gap-6">
      <Count n={d.leave} label="leave and attendance requests" urgent />
    </div>
  ),
  'review-queue': (d) => (<><Count n={d.count} label="waiting for your decision" urgent /><DocList items={d.items} count={d.count} /></>),
  'my-revisions': (d) => (<><Count n={d.count} label="sent back for changes" urgent /><DocList items={d.items} count={d.count} /></>),
  'rereview-due': (d) => (<><Count n={d.count} label={d.overdue > 0 ? `${d.overdue} overdue` : 'due soon'} urgent={d.overdue > 0} /><DocList items={d.items} count={d.count} /></>),
  acknowledgements: (d) => (<><Count n={d.count} label="not yet acknowledged" urgent /><DocList items={d.items} count={d.count} /></>),
  'my-tasks': (d) => (d.openTasks > 0 ? <Count n={d.openTasks} label="tasks assigned to you" urgent /> : <p className="text-xs text-slate-600">Your exit clearance is in progress.</p>),
  attendance: (d) => (
    <div className="text-xs text-slate-600 space-y-1">
      <div>Check-in: <b className="text-slate-800">{d.checkIn || 'not yet'}</b></div>
      <div>Check-out: <b className="text-slate-800">{d.checkOut || 'not yet'}</b></div>
    </div>
  ),
  'leave-balance': (d) => (
    d.balances.length === 0 ? <p className="text-xs text-slate-500">No leave types with a balance.</p> : (
      <div className="grid grid-cols-2 gap-3">
        {d.balances.map((b: any) => (
          <div key={b.code}>
            <div className="text-2xl font-black tabular-nums text-slate-800">{b.balance}</div>
            <div className="text-xs text-slate-500 truncate">{b.name}{b.pending > 0 ? ` · ${b.pending} pending` : ''}</div>
          </div>
        ))}
      </div>
    )
  ),
  'latest-payslip': (d) => (
    <div>
      <div className="text-xs text-slate-500">{monthLabel(d.month)}</div>
      <div className="text-2xl font-black tabular-nums text-slate-800">{inr(d.net)}</div>
      <div className="text-[11px] text-slate-400">Take-home · gross {inr(d.gross)}</div>
    </div>
  ),
  compliance: (d) => (
    <div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-black tabular-nums text-slate-800">{d.rate === null ? '–' : `${d.rate}%`}</span>
        <span className="text-xs text-slate-500 pb-1">{d.acknowledged} of {d.total} acknowledged</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${d.rate || 0}%` }} /></div>
    </div>
  ),
  hiring: (d) => (
    <div className="space-y-1.5">
      {d.waiting.map((w: any) => (
        <div key={w.status} className="flex items-center justify-between text-xs"><span className="text-slate-700">{w.label}</span><b className="text-[#FA7014]">{w.count}</b></div>
      ))}
      <div className="text-[11px] text-slate-400">{d.open} open requisition{d.open === 1 ? '' : 's'}</div>
    </div>
  ),
  'people-tasks': (d) => <Count n={d.open} label="open onboarding and exit tasks" />,
  'payroll-run': (d) => (
    d.run ? <div className="text-xs text-slate-600"><b className="text-slate-800">{monthLabel(d.run.month)}</b> · {String(d.run.status).toLowerCase()}</div>
      : <p className="text-xs text-slate-500">No payroll run yet.</p>
  ),
  admin: (d) => (
    <div className="text-xs text-slate-600">
      {d.activeEmployees !== null && <Count n={d.activeEmployees} label="active employees" />}
    </div>
  ),
};

export const WidgetCard: React.FC<{ w: DashboardWidget; onOpen: (t: WidgetTarget) => void }> = ({ w, onOpen }) => (
  <Card title={w.title} subtitle={w.reason}
    className={w.urgent ? 'border-[#FA7014]/40' : ''}
    right={w.target ? (
      <button type="button" onClick={() => onOpen(w.target!)} className="text-xs font-bold text-[#FA7014] inline-flex items-center gap-1 hover:underline" aria-label={`Open ${w.title}`}>
        Open <ArrowRight className="w-3 h-3" />
      </button>
    ) : undefined}>
    {BODY[w.id]!(w.data)}
  </Card>
);
