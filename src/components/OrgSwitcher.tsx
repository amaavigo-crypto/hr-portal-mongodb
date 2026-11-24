import React, { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { orgService, type OrganisationRow } from '../services/orgService';

/** Shown only to group administrators. Lists the organisations of their account and switches between them. */
export const OrgSwitcher: React.FC<{ currentName: string }> = ({ currentName }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OrganisationRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || rows) return;
    orgService.list().then((d) => setRows(d.organisations)).catch((e) => setErr(e.message));
  }, [open, rows]);

  const pick = async (o: OrganisationRow) => {
    if (o.current || busy) return;
    setBusy(o.id); setErr('');
    try { await orgService.switchTo(o.id); } catch (e: any) { setErr(e.message); setBusy(null); }
  };

  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[44px] flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 px-3 text-left text-white">
        <Building2 className="w-4 h-4 shrink-0 text-indigo-200" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-wide text-indigo-200/80">Organisation</span><span className="block truncate text-[13px] font-bold">{currentName}</span></span>
        <ChevronDown className="w-4 h-4 shrink-0 text-indigo-200" aria-hidden />
      </button>
      {open && (
        <div role="listbox" aria-label="Organisations" className="absolute z-50 mt-1 w-full rounded-xl bg-white text-slate-800 shadow-xl border border-slate-200 p-1">
          {!rows && !err && <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>}
          {err && <p className="px-3 py-2 text-xs text-rose-700">{err}</p>}
          {rows?.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.current} disabled={!!busy || o.status !== 'ACTIVE'} onClick={() => void pick(o)}
              className="w-full min-h-[44px] flex items-center gap-2 rounded-lg px-3 text-left text-[13px] hover:bg-slate-100 disabled:opacity-50">
              <span className="min-w-0 flex-1 truncate font-semibold">{o.name}{o.home ? <span className="ml-1 font-normal text-slate-500">(yours)</span> : null}{o.status !== 'ACTIVE' ? <span className="ml-1 font-normal text-slate-500">· not active</span> : null}</span>
              {o.current && <Check className="w-4 h-4 text-[#6d4aff]" aria-label="Current" />}
              {busy === o.id && <span className="text-[11px] text-slate-500">Switching…</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
