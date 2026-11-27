import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { orgService, type MyOrganisations } from '../services/orgService';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** Group administrators: see the account's organisations, add a new one (optionally copying set-up), and manage who else is a group administrator. */
export const OrganisationsTab: React.FC = () => {
  const [data, setData] = useState<MyOrganisations | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [clone, setClone] = useState({ departments: true, roles: true, leaveSettings: true });
  const [adminEmail, setAdminEmail] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await orgService.list();
      setData(d);
      setFrom((f) => f || d.organisations.find((o) => o.current)?.id || d.organisations[0]?.id || '');
    } catch (e) { setError(msg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(''); setNotice('');
    try { const m = await fn(); if (m) setNotice(m); await load(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  if (!data) return <div className="flex justify-center p-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const used = data.organisations.length;
  const full = used >= data.account.orgLimit;

  return (
    <div className="space-y-4">
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">{notice}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-black text-slate-900">Organisations in {data.account.name}</h2>
          <span className="text-xs font-bold text-slate-500">{used} of {data.account.orgLimit} used</span>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {data.organisations.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <span className="font-semibold text-slate-800">{o.name}{o.home && <span className="ml-2 text-[10px] font-bold text-slate-400">HOME</span>}{o.current && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-[#6050D0]">VIEWING</span>}</span>
              {!o.current && <button disabled={busy} onClick={() => orgService.switchTo(o.id).catch((e) => setError(msg(e)))} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">Switch</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-black text-slate-900">Add an organisation</h2>
        {full ? (
          <p className="text-xs text-slate-500">Your plan allows {data.account.orgLimit} organisation{data.account.orgLimit === 1 ? '' : 's'}. Contact us to raise the limit.</p>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => {
            const r = await orgService.createOrganisation({ name, cloneFromCompanyId: from, clone });
            setName('');
            return `${r.company.name} created${r.copied.length ? ` with ${r.copied.join(', ')}` : ''}. Use Switch to open it and add its first people.`;
          }); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organisation name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="text-xs text-slate-600">
              <label className="mr-2 font-bold">Copy set-up from</label>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1">
                {data.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <div className="mt-2 flex flex-wrap gap-4">
                {([['departments', 'Departments'], ['roles', 'Custom roles'], ['leaveSettings', 'Leave & people settings']] as const).map(([k, l]) => (
                  <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={clone[k]} onChange={(e) => setClone({ ...clone, [k]: e.target.checked })} /> {l}</label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">People are never copied. Move them with Transfer people.</p>
            </div>
            <button disabled={busy || name.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-lg bg-[#6050D0] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#5243BE] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create organisation
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-black text-slate-900">Group administrators</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {(data.groupAdmins || []).map((g) => (
            <li key={g.uid} className="flex items-center justify-between py-2">
              <span><b>{g.name}</b> <span className="text-xs text-slate-500">{g.email}</span></span>
              <button disabled={busy || (data.groupAdmins || []).length < 2} title={(data.groupAdmins || []).length < 2 ? 'There must be at least one group administrator' : 'Remove'}
                onClick={() => window.confirm(`Remove ${g.name} as a group administrator?`) && run(async () => { await orgService.setGroupAdmin(g.email, false); })}
                className="rounded-lg border border-rose-200 p-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await orgService.setGroupAdmin(adminEmail.trim(), true); setAdminEmail(''); return 'Group administrator added.'; }); }}>
          <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Email of an existing user in this account" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <button disabled={busy || !adminEmail.includes('@')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Add</button>
        </form>
      </section>
    </div>
  );
};
