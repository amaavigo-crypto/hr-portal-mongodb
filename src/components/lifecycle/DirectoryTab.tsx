import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { buildOrgTree, flattenOrg, type OrgNode } from '../../../shared/lifecycleEngine';
import { employeeCodeProblem, normalizeEmployeeCode } from '../../../shared/employeeCode';
import { Search, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { Card, Notice, btnGhost, input, useRunner } from '../leave/ui';
import { Avatar as ColorAvatar } from '../home/parts';

const AUTO = '__auto';
type P = { uid: string; name: string; email: string; empId: string; department: string; title: string; active: boolean; managerUid: string; managerName: string; managerManual: boolean; joinDate: string; directReports: number };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');

const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span className="w-8 h-8 rounded-full bg-[#6050D0]/15 text-[#6050D0] text-[11px] font-bold flex items-center justify-center shrink-0">{initials(name)}</span>
);

const OrgBranch: React.FC<{ node: OrgNode<P>; depth: number; open: Set<string>; toggle: (uid: string) => void; me: string }> = ({ node, depth, open, toggle, me }) => {
  const p = node.person;
  const isOpen = open.has(p.uid);
  return (
    <li>
      <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.uid === me ? 'bg-[#6050D0]/10' : 'hover:bg-slate-50'}`} style={{ marginLeft: depth * 20 }}>
        {node.children.length > 0 ? (
          <button type="button" aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => toggle(p.uid)} className="w-5 h-5 text-xs font-bold text-slate-500 border border-slate-300 rounded">{isOpen ? '−' : '+'}</button>
        ) : <span className="w-5" />}
        <Avatar name={p.name} />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">{p.name}{!p.active && <span className="ml-2 text-[10px] text-slate-400">inactive</span>}</div>
          <div className="text-[11px] text-slate-500 truncate">{[p.title, p.department].filter(Boolean).join(' · ') || p.email}</div>
        </div>
        {node.total > 0 && <span className="ml-auto text-[10px] font-bold text-slate-500 whitespace-nowrap">{node.children.length} direct · {node.total} total</span>}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul className="border-l border-slate-200" style={{ marginLeft: depth * 20 + 18 }}>
          {node.children.map((c) => <OrgBranch key={c.person.uid} node={c} depth={0} open={open} toggle={toggle} me={me} />)}
        </ul>
      )}
    </li>
  );
};

/** Directory (search, filter) and the reporting tree. HR and leave managers can change who someone reports to. */
export const DirectoryTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [data, setData] = useState<{ people: P[]; canEdit: boolean; me: string } | null>(null);
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [codeEdit, setCodeEdit] = useState<{ uid: string; value: string } | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(() => lifecycleService.directory(canManage && showAll).then(setData).catch(() => undefined), [canManage, showAll]);
  useEffect(() => { load(); }, [load]);

  const people = data?.people || [];
  const tree = useMemo(() => buildOrgTree(people), [people]);
  useEffect(() => { setOpen(new Set(tree.map((n) => n.person.uid))); }, [tree]);

  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const depts = Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort();
  const needle = q.trim().toLowerCase();
  const rows = people.filter((p) => (!dept || p.department === dept) && (!needle || [p.name, p.email, p.empId, p.title, p.department].some((x) => x.toLowerCase().includes(needle))));
  const toggle = (uid: string) => setOpen((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const allUids = flattenOrg(tree).filter((x) => x.total > 0).map((x) => x.person.uid);
  const PAGE = 10;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const noManager = people.filter((p) => p.active && !p.managerUid).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
          {([['list', 'Directory'], ['chart', 'Org chart']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-md ${view === k ? 'bg-[#6050D0] text-white' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
        {view === 'list' && (
          <>
            <label className="relative min-w-[240px] max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#6050D0]" placeholder="Search employee by name, email or role…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#6050D0]" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }}>
              <option value="">All Departments</option>
              {depts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </>
        )}
        {view === 'chart' && (
          <>
            <button className={btnGhost} onClick={() => setOpen(new Set(allUids))}>Expand all</button>
            <button className={btnGhost} onClick={() => setOpen(new Set())}>Collapse all</button>
          </>
        )}
        {canManage && <label className="text-xs text-slate-600 flex items-center gap-1.5 ml-auto"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include inactive people</label>}
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {data.canEdit && noManager > 1 && <Notice>{noManager} active people have no reporting manager (one is normally the head of the company). Set them here so approvals and the chart are right.</Notice>}

      {view === 'list' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-xs font-bold text-slate-700"><th className="p-3">Employee</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Reports to</th><th className="p-3">Joined</th><th className="p-3">Status</th></tr></thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.uid} className="border-b border-slate-100 align-middle">
                    <td className="p-2"><div className="flex items-center gap-3"><ColorAvatar name={p.name} /><div><div className="font-bold text-slate-900">{p.name}</div><a className="text-slate-500 hover:underline" href={`mailto:${p.email}`}>{p.email}</a></div></div></td>
                    <td className="p-2">
                      {p.title || '–'}
                      {codeEdit?.uid === p.uid ? (
                        <form className="mt-1 flex items-center gap-1" onSubmit={(e) => {
                          e.preventDefault();
                          const value = normalizeEmployeeCode(codeEdit.value);
                          if (value === p.empId) { setCodeEdit(null); return; }
                          run(async () => { await lifecycleService.setEmpId(p.uid, value); setCodeEdit(null); await load(); }, `Employee code for ${p.name} is now ${value}.`);
                        }}>
                          <input autoFocus className={`${input} !py-1 !w-28 text-xs uppercase`} aria-label={`Employee code for ${p.name}`} maxLength={20} value={codeEdit.value}
                            onChange={(e) => setCodeEdit({ uid: p.uid, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setCodeEdit(null); }} />
                          <button type="submit" disabled={busy || !!employeeCodeProblem(codeEdit.value)} className="rounded-md bg-[#6050D0] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40">Save</button>
                          <button type="button" onClick={() => setCodeEdit(null)} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600">Cancel</button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-1 text-slate-400">
                          {p.empId || (data.canEdit ? 'No code' : '')}
                          {data.canEdit && <button type="button" aria-label={`Change employee code for ${p.name}`} title="Change employee code" disabled={busy} onClick={() => setCodeEdit({ uid: p.uid, value: p.empId })} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-[#6050D0]"><Pencil className="h-3 w-3" /></button>}
                        </div>
                      )}
                    </td>
                    <td className="p-2">{p.department || '–'}</td>
                    <td className="p-2">
                      {data.canEdit ? (
                        <>
                          <select className={`${input} !py-1 text-xs`} disabled={busy} value={p.managerManual ? p.managerUid : AUTO} aria-label={`Manager of ${p.name}`}
                            onChange={(e) => run(async () => { await (e.target.value === AUTO ? lifecycleService.useDepartmentHead(p.uid) : lifecycleService.setManager(p.uid, e.target.value)); await load(); }, 'Reporting line updated.')}>
                            <option value={AUTO}>Department head (automatic)</option>
                            <option value="">No manager</option>
                            {people.filter((m) => m.active && m.uid !== p.uid).map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                          </select>
                          <div className="mt-0.5 text-[10px] text-slate-400">{p.managerManual ? 'Set by hand' : p.managerName ? `${p.managerName}, head of ${p.department}` : p.department ? `${p.department} has no head yet` : 'No department'}</div>
                        </>
                      ) : (p.managerName || '–')}
                    </td>
                    <td className="p-2">{p.joinDate || '–'}</td>
                    <td className="p-2"><span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{p.active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>{rows.length === 0 ? 'Showing 0' : `Showing ${(cur - 1) * PAGE + 1} – ${Math.min(cur * PAGE, rows.length)}`} of {rows.length} people{rows.length !== people.length ? ` (${people.length} in total)` : ''}</span>
            {pages > 1 && (
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label="Previous page" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
                {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, cur - 3), Math.max(0, cur - 3) + 5).map((k) => <button key={k} type="button" onClick={() => setPage(k)} className={`h-9 w-9 rounded-lg border text-sm font-semibold cursor-pointer ${k === cur ? 'border-[#6050D0] bg-[#6050D0] text-white' : 'border-slate-200 text-slate-700'}`}>{k}</button>)}
                <button type="button" aria-label="Next page" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <Card>
          {tree.length === 0 ? <p className="text-sm text-slate-400">No people yet.</p> : <ul className="space-y-0.5">{tree.map((n) => <OrgBranch key={n.person.uid} node={n} depth={0} open={open} toggle={toggle} me={data.me} />)}</ul>}
        </Card>
      )}
    </div>
  );
};
