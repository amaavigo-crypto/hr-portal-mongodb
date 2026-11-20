import React, { useEffect, useState } from 'react';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { hm, useRunner } from '../leave/ui';
import { useLoad } from './useLoad';

/** Minutes since midnight in IST, refreshed every 30 seconds. */
const useIstMinutes = () => {
  const calc = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const [m, setM] = useState(calc);
  useEffect(() => { const id = setInterval(() => setM(calc()), 30_000); return () => clearInterval(id); }, []);
  return m;
};
const toMin = (hhmm?: string | null) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

type Att = { checkIn: string | null; checkOut: string | null; open?: boolean; openSince?: string | null; workedMinutes?: number };

/**
 * The first thing on Home for everyone who has attendance set up: where they stand today and one big button to punch in or out.
 * It stays pinned at the top while the rest of Home scrolls. People without attendance (not set up, no employee record) see nothing.
 * The full punch history and remarks stay on the Online attendance card further down.
 */
export const PunchBar: React.FC<{ refreshKey: number; onChanged: () => void }> = ({ refreshKey, onChanged }) => {
  const me = useLoad(() => leaveService.me(), [refreshKey]);
  const { busy, note, run } = useRunner();
  const nowMin = useIstMinutes();
  const d = me.data as any;
  if (!d || d.configured === false || d.found === false) return null;
  const att = (d.attendanceToday || {}) as Att;
  const state: 'out' | 'in' | 'back' = !att.checkIn ? 'out' : att.open ? 'in' : 'back';
  const worked = (att.workedMinutes || 0) + (att.open && att.openSince ? Math.max(0, nowMin - toMin(att.openSince)) : 0);

  const punch = () => run(async () => {
    if (att.open) await leaveService.checkOut(''); else await leaveService.checkIn('');
    me.reload();
    onChanged();
  }, att.open ? 'Punched out' : 'Punched in');

  const headline = state === 'out' ? 'You have not punched in today' : state === 'in' ? `Working since ${att.openSince || att.checkIn}` : `Punched out${att.checkOut ? ` at ${att.checkOut}` : ''}`;
  const sub = state === 'out' ? 'Punch in to start your day.' : `${hm(worked) || '0h 00m'} worked today`;

  return (
    <section aria-label="Attendance today" className={`sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-sm ${state === 'out' ? 'border-[#F36B21]/40 bg-orange-50' : 'border-emerald-200 bg-emerald-50'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${state === 'out' ? 'bg-orange-100 text-[#F36B21]' : 'bg-emerald-100 text-emerald-700'}`}><Clock className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-slate-900">{headline}</div>
        <div className="truncate text-xs text-slate-600">{note?.tone === 'error' ? <span className="font-semibold text-rose-700" role="alert">{note.text}</span> : sub}</div>
      </div>
      <button type="button" onClick={() => void punch()} disabled={busy}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50 ${att.open ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#F36B21] hover:bg-[#df5d18]'}`}>
        {att.open ? <><LogOut className="h-4 w-4" />Punch out</> : <><LogIn className="h-4 w-4" />{att.checkIn ? 'Punch in again' : 'Punch in'}</>}
      </button>
    </section>
  );
};

export default PunchBar;
