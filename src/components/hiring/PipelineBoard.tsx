import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Search } from 'lucide-react';
import { Avatar } from '../home/parts';
import { pipelineService } from '../../services/pipelineService';
import { subscribeToRequisitions } from '../../services/requisitionService';
import { Requisition } from '../../types';
import { useLoad } from '../common/loadUi';

export const PERIODS = [{ days: 7, label: 'Last 7 Days' }, { days: 30, label: 'Last 30 Days' }, { days: 90, label: 'Last 90 Days' }, { days: 0, label: 'All time' }];

/** Which board column a candidate sits in. Rejected candidates are not on the board. */
export const stageOf = (status: string): number | null => {
  const s = String(status || '').toLowerCase();
  if (s.includes('reject')) return null;
  if (s.includes('joining') || s.includes('joined') || s.includes('hired')) return 4;
  if (s.includes('offer') || s.includes('selected')) return 3;
  if (s.includes('interview')) return 2;
  if (s.includes('screen')) return 1;
  return 0;
};
/** The board columns, left to right. */
export const STAGES = ['Sourced', 'Screening', 'Interview', 'Offer', 'Joined'];

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? 'today' : `${d}d ago`;
};
const inWindow = (iso: string | undefined, from: number, to: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from && t < to;
};

export interface PipelineData {
  rows: any[]; all: any[]; reqs: Requisition[]; days: number; loading: boolean; error: string; reload: () => void;
  trend: { candidates: number | null; reqs: number | null; interviews: number | null; offers: number | null; joined: number | null };
}

/** One load of the candidate board and requisitions, narrowed to the chosen period. */
export const usePipelineData = (days: number, refreshKey: number): PipelineData => {
  const board = useLoad(() => pipelineService.board(), [refreshKey]);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  useEffect(() => {
    try { return subscribeToRequisitions(setReqs); } catch { return undefined; }
  }, []);
  const all: any[] = board.data?.rows || [];
  const now = Date.now();
  const span = days * 86400_000;
  const rows = days ? all.filter((r) => !r.createdAt || now - new Date(r.createdAt).getTime() <= span) : all;
  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const stageTrend = (n: number) => pct(
    all.filter((r) => stageOf(r.status) === n && inWindow(r.createdAt, now - span, now + 1)).length,
    all.filter((r) => stageOf(r.status) === n && inWindow(r.createdAt, now - 2 * span, now - span)).length);
  const trend = days ? {
    candidates: pct(all.filter((r) => inWindow(r.createdAt, now - span, now + 1)).length, all.filter((r) => inWindow(r.createdAt, now - 2 * span, now - span)).length),
    reqs: pct(reqs.filter((r) => inWindow(r.publishedAt || r.createdAt, now - span, now + 1)).length, reqs.filter((r) => inWindow(r.publishedAt || r.createdAt, now - 2 * span, now - span)).length),
    // Stage trends compare candidates added in each period who are now at that stage.
    interviews: stageTrend(2), offers: stageTrend(3), joined: stageTrend(4),
  } : { candidates: null, reqs: null, interviews: null, offers: null, joined: null };
  return { rows, all, reqs, days, loading: board.loading, error: board.error || '', reload: board.reload, trend };
};

const SELECT = 'h-9 rounded-lg border border-[#dfe1e5] bg-white px-3 text-[13px] text-[#16181d] outline-none focus:border-[#4C3EB0]';

export const PipelineBoard: React.FC<{ d: PipelineData; onOpenCandidate: (id: string) => void }> = ({ d, onOpenCandidate }) => {
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');

  // A candidate's department comes from the requisition for the same role, when there is one.
  const deptOfRole = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of d.reqs) if (r.positionTitle && r.departmentName) m.set(r.positionTitle.toLowerCase(), r.departmentName);
    return m;
  }, [d.reqs]);
  const roles = useMemo(() => Array.from(new Set(d.rows.map((r) => r.designation).filter(Boolean))).sort() as string[], [d.rows]);
  const depts = useMemo(() => Array.from(new Set(d.rows.map((r) => deptOfRole.get(String(r.designation || '').toLowerCase())).filter(Boolean))).sort() as string[], [d.rows, deptOfRole]);
  const sources = useMemo(() => Array.from(new Set(d.rows.map((r) => r.source).filter(Boolean))).sort() as string[], [d.rows]);

  const shown = d.rows.filter((r) => stageOf(r.status) !== null
    && (!role || r.designation === role)
    && (!dept || deptOfRole.get(String(r.designation || '').toLowerCase()) === dept)
    && (!source || r.source === source)
    && (!q || `${r.name} ${r.designation} ${r.email}`.toLowerCase().includes(q.toLowerCase())));
  const filtered = !!(role || dept || source || q);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input className="h-9 w-full rounded-lg border border-[#dfe1e5] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#4C3EB0]" placeholder="Search by name, email or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" /></div>
        <select className={SELECT} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option>{roles.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {depts.length > 0 && <select className={SELECT} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
        <select className={SELECT} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">All sources</option>{sources.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {filtered && <button type="button" className="h-9 cursor-pointer px-2 text-[13px] font-semibold text-[#3F3393] hover:underline" onClick={() => { setRole(''); setDept(''); setSource(''); setQ(''); }}>Clear filters</button>}
      </div>
      {d.error && <p className="rounded-lg bg-[#fdeceb] px-4 py-3 text-sm text-[#b42318]" role="alert">{d.error}</p>}

      <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Candidates by stage">
        {STAGES.map((stage, i) => {
          const list = shown.filter((r) => stageOf(r.status) === i);
          return (
            <section key={stage} className="flex min-w-[220px] flex-1 flex-col rounded-[10px] bg-[#f6f6f7] p-2">
              <header className="flex items-center justify-between px-1.5 py-1.5">
                <h3 className="text-[13px] font-semibold text-[#16181d]">{stage}</h3>
                <span className="text-xs tabular-nums text-[#5c626d]">{list.length}</span>
              </header>
              <ul className="max-h-[62vh] min-h-40 space-y-2 overflow-y-auto">
                {list.length === 0 && <li className="px-2 py-6 text-center text-xs text-[#5c626d]">{d.loading ? 'Loading…' : 'No candidates'}</li>}
                {list.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpenCandidate(r.id)} className="w-full cursor-pointer rounded-lg border border-[#e8e9ec] bg-white p-3 text-left hover:border-[#c9ccd2]">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name || '?'} />
                        <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-[#16181d]">{r.name}</div><div className="truncate text-xs text-[#5c626d]">{r.designation || '—'}</div></div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5 text-xs text-[#5c626d]">
                        {i >= 3 ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#05603a]" /><span className="truncate">{r.status}</span></>
                          : i === 2 && r.nextInterview ? <><CalendarDays className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{new Date(r.nextInterview).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></>
                          : <span>Added {ago(r.createdAt) || '—'}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};
