import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarRange, Clock, Users } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { dayLabel, type TeamWeek as Week, type PersonWeek } from '../../../shared/teamWeek';
import { Card, EmptyState, Notice, Skeleton } from './ui';
import { PageHead } from './kit';

const PersonRow: React.FC<{ p: PersonWeek }> = ({ p }) => (
  <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
    <span className="font-semibold text-slate-900">{p.name}</span>
    <span className="text-slate-600">
      {p.days.length === 1 ? dayLabel(p.days[0]) : `${dayLabel(p.days[0])} to ${dayLabel(p.days[p.days.length - 1])}`}
      {p.pending && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">Not approved yet</span>}
    </span>
  </li>
);

/** For managers: who in the team is away this week and next, and what is waiting for their decision. */
export const TeamWeek: React.FC = () => {
  const [data, setData] = useState<{ team: boolean; week?: Week; intro?: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { leaveService.teamWeek().then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Skeleton rows={4} />;
  const w = data.week;
  return (
    <div className="space-y-4">
      <PageHead title="Team this week" subtitle="Who is away, which days are busy and what is waiting for you." />
      {!data.team || !w ? (
        <Card><EmptyState icon={Users} title="You do not have a team yet" text="This page shows the people who report to you. It will fill in once HR sets you as someone's manager." /></Card>
      ) : (
        <>
          <Card>
            <p className="text-sm text-slate-800">{data.intro}</p>
            <p className="mt-1 text-xs text-slate-500">Team of {w.size}. Week of {dayLabel(w.weekStart)} to {dayLabel(w.weekEnd)}. You also get this by email on Monday.</p>
          </Card>
          {w.overLimit.length > 0 && (
            <Notice tone="warn"><AlertTriangle className="mr-1.5 inline h-4 w-4" />More than {w.limitPct}% of your team is away on {w.overLimit.map((d) => `${dayLabel(d.day)} (${d.away} of ${w.size})`).join(', ')}. You may want to plan cover.</Notice>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="On leave this week" right={<CalendarRange className="h-4 w-4 text-slate-400" />}>
              {w.thisWeek.length ? <ul className="space-y-2">{w.thisWeek.map((p) => <PersonRow key={p.uid} p={p} />)}</ul> : <p className="text-sm text-slate-500">Nobody is on leave this week.</p>}
            </Card>
            <Card title="Next week" subtitle={`${dayLabel(w.nextStart)} to ${dayLabel(w.nextEnd)}`}>
              {w.nextWeek.length ? <ul className="space-y-2">{w.nextWeek.map((p) => <PersonRow key={p.uid} p={p} />)}</ul> : <p className="text-sm text-slate-500">Nobody has leave booked yet.</p>}
            </Card>
          </div>
          <Card title="Waiting for your decision" right={<Clock className="h-4 w-4 text-slate-400" />}>
            {w.waiting.length ? (
              <ul className="space-y-2">
                {w.waiting.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span><b className="text-slate-900">{r.name}</b> <span className="text-slate-600">{r.typeName}, {dayLabel(r.from)}{r.to !== r.from ? ` to ${dayLabel(r.to)}` : ''}</span></span>
                    <span className="text-xs text-slate-500">Waiting {r.waitingDays} day{r.waitingDays === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Nothing is waiting for you.</p>}
            <p className="mt-3 text-xs text-slate-500">Open Approvals to approve or reject.</p>
          </Card>
        </>
      )}
    </div>
  );
};
