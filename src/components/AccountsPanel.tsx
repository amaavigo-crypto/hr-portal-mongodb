import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { orgService, type AccountRow } from '../services/orgService';
import { MODULES } from '../../shared/permissions';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** Platform administrators: organisation limit, plan and modules for a whole account, and who its first group administrator is. */
export const AccountsPanel: React.FC = () => {
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<Record<string, { limit?: string; modules?: string[]; email?: string }>>({});

  const load = useCallback(async () => { try { setRows((await orgService.accounts()).accounts); } catch (e) { setError(msg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (a: AccountRow) => {
    const d = edit[a.id] || {};
    setBusy(a.id); setError('');
    try {
      if (d.limit !== undefined || d.modules) await orgService.updateAccount({ accountId: a.id, ...(d.limit !== undefined ? { orgLimit: Number(d.limit) } : {}), ...(d.modules ? { modules: d.modules } : {}) });
      if (d.email?.trim()) await orgService.setGroupAdmin(d.email.trim(), true, a.id);
      setEdit((e) => { const n = { ...e }; delete n[a.id]; return n; });
      await load();
    } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  };

  if (!rows) return <div className="flex justify-center p-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return (
    <div className="space-y-3">
      <div><h1 className="text-2xl font-black tracking-tight text-slate-900">Accounts</h1><p className="text-sm text-slate-500">An account groups a customer's organisations. Modules set here apply to all of them.</p></div>
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</div>}
      {rows.map((a) => {
        const d = edit[a.id] || {};
        const mods = d.modules ?? a.modules ?? [];
        const dirty = d.limit !== undefined || d.modules !== undefined || !!d.email;
        return (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><b className="text-slate-900">{a.name}</b> <span className="text-xs text-slate-500">{a.ownerEmail} · {a.organisations} organisation{a.organisations === 1 ? '' : 's'} · {(a.groupAdminUids || []).length} group admin{(a.groupAdminUids || []).length === 1 ? '' : 's'}</span></div>
              <label className="text-xs font-bold text-slate-600">Limit <input type="number" min={1} value={d.limit ?? a.orgLimit} onChange={(e) => setEdit({ ...edit, [a.id]: { ...d, limit: e.target.value } })} className="ml-1 w-16 rounded-lg border border-slate-200 px-2 py-1" /></label>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {MODULES.map((m) => (
                <label key={m.key} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={mods.includes(m.key)} onChange={(e) => setEdit({ ...edit, [a.id]: { ...d, modules: e.target.checked ? [...mods, m.key] : mods.filter((x) => x !== m.key) } })} /> {m.label}</label>
              ))}
            </div>
            {!a.modules && !d.modules && <p className="mt-1 text-[11px] text-slate-400">No account-wide modules set yet. Each organisation keeps its own until you save here.</p>}
            <div className="mt-2 flex gap-2">
              <input value={d.email || ''} onChange={(e) => setEdit({ ...edit, [a.id]: { ...d, email: e.target.value } })} placeholder="Add a group administrator by email" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs" />
              <button disabled={!dirty || busy === a.id} onClick={() => save(a)} className="rounded-lg bg-[#6050D0] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === a.id ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
