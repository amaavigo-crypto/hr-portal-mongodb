import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { orgService, type TransferOutcomeRow, type TransferRequestRow } from '../../services/orgService';
import { Card, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

type P = { uid: string; name: string; email: string; empId: string; department: string; title: string; active: boolean; directReports: number };
type Rule = 'batch' | 'none' | 'all';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Move people to another organisation of the same account: by department, one by one, or many at once. */
export const TransferTab: React.FC = () => {
  const [people, setPeople] = useState<P[] | null>(null);
  const [info, setInfo] = useState<{ direct: boolean; organisations: { id: string; name: string; status: string }[]; leaveTypes: string[] } | null>(null);
  const [requests, setRequests] = useState<TransferRequestRow[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today());
  const [carry, setCarry] = useState<'none' | 'all' | 'choose'>('none');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [results, setResults] = useState<TransferOutcomeRow[] | null>(null);
  const { busy, note: msg, setNote: setMsg, run } = useRunner();

  const load = useCallback(async () => {
    try {
      const [d, s, r] = await Promise.all([lifecycleService.directory(false), orgService.siblings(), orgService.requests().catch(() => ({ requests: [] as TransferRequestRow[] }))]);
      setPeople((d.people as P[]).filter((p) => p.active));
      setInfo(s); setRequests(r.requests); setLoadErr('');
    } catch (e: any) { setLoadErr(e.message || 'Could not load.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const depts = useMemo(() => [...new Set((people || []).map((p) => p.department).filter(Boolean))].sort(), [people]);
  const shown = useMemo(() => (people || []).filter((p) => (!dept || p.department === dept) && (!q.trim() || `${p.name} ${p.empId} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()))), [people, dept, q]);
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.uid));
  const toggle = (uid: string) => setPicked((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const toggleShown = () => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (allShownPicked ? n.delete(p.uid) : n.add(p.uid))); return n; });
  const pickedPeople = (people || []).filter((p) => picked.has(p.uid));
  const managers = pickedPeople.filter((p) => p.directReports > 0);
  const destName = info?.organisations.find((o) => o.id === to)?.name || '';

  const submit = () => run(async () => {
    const perPerson: Record<string, 'none' | 'all'> = {};
    for (const [uid, r] of Object.entries(rules)) if (picked.has(uid) && r !== 'batch') perPerson[uid] = r;
    const body = { toCompanyId: to, uids: [...picked], effectiveDate: date, carry, carryTypes: carry === 'choose' ? [...types] : undefined, perPerson, note: note.trim() || undefined };
    if (info?.direct) {
      const r = await orgService.transfer(body);
      setResults(r.results);
      setPicked(new Set(r.results.filter((x) => !x.ok).map((x) => x.uid)));
    } else {
      await orgService.propose(body);
      setPicked(new Set());
      setMsg({ tone: 'ok', text: 'Sent to the group administrator for approval.' });
    }
    await load();
  });

  const decide = (id: string, approve: boolean) => run(async () => {
    const r = await orgService.decide(id, approve);
    if (approve) setResults(r.results);
    await load();
  }, approve ? 'Approved and moved' : 'Request declined');

  if (loadErr) return <Notice tone="error">{loadErr}</Notice>;
  if (!people || !info) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!info.organisations.length) return <Notice tone="info">Your account has only one organisation, so there is nobody to move people to yet.</Notice>;
  const pending = requests.filter((r) => r.status === 'PENDING');
  const ready = picked.size > 0 && !!to && !busy && (carry !== 'choose' || types.size > 0);

  return (
    <div className="space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {pending.length > 0 && (
        <Card title="Waiting for approval" subtitle={info.direct ? 'Requests from HR in your organisations.' : 'Your requests waiting for the group administrator.'}>
          <ul className="divide-y divide-slate-100">
            {pending.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex-1 min-w-[220px]"><b>{r.input.uids.length}</b> {r.input.uids.length === 1 ? 'person' : 'people'} · {r.fromCompanyName} → {r.toCompanyName}<span className="block text-xs text-slate-500">Proposed by {r.proposedBy}{r.input.note ? ` · ${r.input.note}` : ''}</span></span>
                {info.direct && <><button type="button" className={btnPrimary} disabled={busy} onClick={() => void decide(r.id, true)}>Approve and move</button><button type="button" className={btnGhost} disabled={busy} onClick={() => void decide(r.id, false)}>Decline</button></>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="1 · Choose people" subtitle="Filter by department, search, or tick people one by one. Use the top box to tick everyone shown.">
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" aria-hidden /><label className="sr-only" htmlFor="tr-search">Search people</label><input id="tr-search" className={`${input} pl-9`} placeholder="Search name, code or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <label className="sr-only" htmlFor="tr-dept">Department</label>
          <select id="tr-dept" className={`${input} max-w-[220px]`} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <span className="self-center text-xs text-slate-500">{picked.size} selected</span>
        </div>
        <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600"><tr>
              <th className="p-2 w-10"><input type="checkbox" aria-label="Select everyone shown" checked={allShownPicked} onChange={toggleShown} /></th>
              <th className="p-2 text-left">Name</th><th className="p-2 text-left">Code</th><th className="p-2 text-left">Department</th><th className="p-2 text-left">Leave balances</th>
            </tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.uid} className="border-t border-slate-100">
                  <td className="p-2"><input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.uid)} onChange={() => toggle(p.uid)} /></td>
                  <td className="p-2 font-semibold">{p.name}{p.directReports > 0 && <span className="ml-2 text-[11px] font-normal text-amber-700">manages {p.directReports}</span>}</td>
                  <td className="p-2">{p.empId}</td><td className="p-2">{p.department || '—'}</td>
                  <td className="p-2">{picked.has(p.uid) && carry !== 'none' ? (
                    <select aria-label={`Leave balances for ${p.name}`} className={`${input} py-1`} value={rules[p.uid] || 'batch'} onChange={(e) => setRules((r) => ({ ...r, [p.uid]: e.target.value as Rule }))}>
                      <option value="batch">As chosen below</option><option value="none">Carry nothing</option><option value="all">Carry all</option>
                    </select>) : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Nobody matches.</td></tr>}
            </tbody>
          </table>
        </div>
        {managers.length > 0 && <div className="mt-3"><Notice tone="warn">{managers.map((m) => m.name).join(', ')} {managers.length === 1 ? 'is' : 'are'} the manager of other people. Those people will have no manager after the move, so assign new managers afterwards.</Notice></div>}
      </Card>

      <Card title="2 · Where and how">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600 space-y-1 block"><span>Move to</span>
            <select className={input} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose organisation…</option>{info.organisations.map((o) => <option key={o.id} value={o.id} disabled={o.status !== 'ACTIVE'}>{o.name}{o.status !== 'ACTIVE' ? ' (not active)' : ''}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 space-y-1 block"><span>Effective date</span>
            <input type="date" className={input} value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-slate-600 mb-1">Leave balances</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {([['none', 'Start from zero'], ['all', 'Carry all balances'], ['choose', 'Carry selected leave types']] as const).map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-2 min-h-[44px]"><input type="radio" name="carry" checked={carry === k} onChange={() => setCarry(k)} />{l}</label>
            ))}
          </div>
          {carry === 'choose' && <div className="flex flex-wrap gap-3 mt-1 text-sm">{info.leaveTypes.map((t) => <label key={t} className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" checked={types.has(t)} onChange={() => setTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })} />{t}</label>)}</div>}
          <p className="text-xs text-slate-500 mt-1">Balances carry only to leave types with the same name in the new organisation. Anything that can't be matched is listed afterwards.</p>
        </fieldset>
        <label className="block mt-4 text-xs font-semibold text-slate-600 space-y-1"><span>Note (optional)</span><input className={input} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
          What happens: each person keeps their login and gets a new employee code in {destName || 'the new organisation'}. Their profile details are copied across. Leave, payroll and other history stay in this organisation. Pending leave requests are cancelled, and the old code is saved on their profile.
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={!ready} onClick={() => void submit()}>{busy ? 'Working…' : info.direct ? `Move ${picked.size || ''} ${picked.size === 1 ? 'person' : 'people'}` : `Propose moving ${picked.size || ''} ${picked.size === 1 ? 'person' : 'people'}`}</button>
          {!info.direct && <span className="text-xs text-slate-500">The group administrator approves before anyone moves.</span>}
        </div>
      </Card>

      {results && (
        <Card title="Result" right={<button type="button" className={btnGhost} onClick={() => setResults(null)}>Close</button>}
          subtitle={`${results.filter((r) => r.ok).length} moved, ${results.filter((r) => !r.ok).length} not moved`}>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-600 text-left"><tr><th className="p-2">Person</th><th className="p-2">Result</th><th className="p-2">New code</th><th className="p-2">Details</th></tr></thead><tbody>
            {results.map((r) => (
              <tr key={r.uid} className="border-t border-slate-100 align-top">
                <td className="p-2 font-semibold">{r.name}</td>
                <td className="p-2">{r.ok ? <span className="text-emerald-700 font-bold">Moved</span> : <span className="text-rose-700 font-bold">Not moved</span>}</td>
                <td className="p-2">{r.toEmpId || '—'}</td>
                <td className="p-2 text-xs text-slate-600">{r.ok ? [
                  r.carried?.length ? `Carried: ${r.carried.map((c) => `${c.days} ${c.type}`).join(', ')}` : '',
                  ...(r.notCarried || []).map((x) => `Not carried: ${x}`),
                  r.cancelledRequests ? `${r.cancelledRequests} pending leave request(s) cancelled` : '',
                  r.reportsCleared ? `${r.reportsCleared} report(s) now have no manager` : '',
                  r.departmentsCleared ? 'was a department head' : '',
                ].filter(Boolean).join(' · ') || 'Done' : r.error}</td>
              </tr>
            ))}
          </tbody></table></div>
        </Card>
      )}
    </div>
  );
};
