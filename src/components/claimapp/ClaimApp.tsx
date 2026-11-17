import React, { useCallback, useEffect, useState } from 'react';
import { Camera, CheckCircle2, ClipboardList, Loader2, LogOut, Send, ShieldCheck, WifiOff, AlertTriangle } from 'lucide-react';
import { payrollService } from '../../services/payrollService';
import { flushQueue, onQueueChange, queued, startAutoSend } from '../../services/claimQueue';
import { QuickClaim } from '../payroll/QuickClaim';
import { Thumb } from '../payroll/ClaimsTab';
import { isInstalled } from '../../services/installApp';

/**
 * The installed phone app. It only does claims: snap a bill and send, see your claims, and (if you are an approver) approve.
 * Everyone sees the same three tabs for now; the server still decides who may approve what.
 */
export const claimAppMode = (): boolean => isInstalled() || new URLSearchParams(window.location.search).get('app') === 'claims';

type Tab = 'claim' | 'mine' | 'approve';
const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const claimNo = (id: string) => `CLM-${String(id).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;
const stamp = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000);
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const TONE: Record<string, string> = { SUBMITTED: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', PAID: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-rose-100 text-rose-800' };
const WORD: Record<string, string> = { SUBMITTED: 'Waiting', APPROVED: 'Approved', PAID: 'Paid', REJECTED: 'Rejected' };
const bigBtn = 'w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-4 font-bold text-base active:scale-[0.99] transition';

const Waiting: React.FC<{ onSent: () => void }> = ({ onSent }) => {
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const c = () => { void queued().then((q) => setN(q.length)); }; c(); return onQueueChange(c); }, []);
  if (!n) return null;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-center gap-2 font-bold"><WifiOff className="h-5 w-5" />Saved on your phone</div>
      <p className="mt-1 text-sm">{n} claim{n > 1 ? 's are' : ' is'} waiting. {n > 1 ? 'They send' : 'It sends'} on their own when you are online.</p>
      <button disabled={busy} onClick={async () => { setBusy(true); await flushQueue(); setBusy(false); onSent(); }} className={`${bigBtn} mt-3 bg-amber-500 text-white`}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}Send now</button>
    </div>
  );
};

const MyClaimsList: React.FC<{ version: number }> = ({ version }) => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { payrollService.myClaims().then((r: any) => { setData(r); setErr(''); }).catch((e: Error) => setErr(e.message)); }, [version]);
  if (err) return <p className="rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700">{navigator.onLine ? err : 'You are offline. Your claims show when you are back online.'}</p>;
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  const items: any[] = data.items || [];
  if (!items.length) return <p className="py-10 text-center text-slate-500">You have not sent any claims yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-lg font-extrabold text-slate-900">{inr(c.amount)}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${TONE[c.status] || 'bg-slate-100 text-slate-700'}`}>{WORD[c.status] || c.status}</span></div>
          <div className="mt-1 text-sm text-slate-600">{c.category} · {stamp(c.createdAt)}</div>
          {c.description && <div className="mt-1 text-sm text-slate-500">{c.description}</div>}
          {['APPROVED', 'PAID'].includes(c.status) && c.approvedAmount !== c.amount && <div className="mt-1 text-sm font-semibold text-emerald-700">Approved {inr(c.approvedAmount)}</div>}
          {c.status === 'REJECTED' && c.decisionNote && <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Reason: {c.decisionNote}</div>}
        </li>
      ))}
    </ul>
  );
};

const ApproveList: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => payrollService.claims('SUBMITTED').then((r: any) => { setItems(r.items || []); setDenied(false); setErr(''); }).catch((e: Error) => { if (/access|permission/i.test(e.message)) setDenied(true); else setErr(e.message); setItems([]); }), []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (c: any, decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !reason.trim()) { setErr('Say why you are rejecting this claim.'); return; }
    setBusy(c.id); setErr('');
    try { await payrollService.decideClaim(decision === 'APPROVE' ? { id: c.id, decision, approvedAmount: c.amount } : { id: c.id, decision, note: reason.trim() }); setRejecting(''); setReason(''); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  if (!items) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (denied) return <p className="py-10 text-center text-slate-500">Claims from your team show here when you are an approver. There is nothing for you to approve.</p>;
  if (!items.length) return <p className="py-10 text-center text-slate-500">{err || 'No claims are waiting for you.'}</p>;
  return (
    <ul className="space-y-4">
      {err && <li className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</li>}
      {items.map((c) => {
        const files: any[] = c.files || [];
        const proof = files.filter((f) => f.kind === 'PROOF');
        const dup = (c.flags || []).filter((f: any) => /DUPLICATE/.test(f.kind || ''));
        return (
          <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between"><span className="font-bold text-slate-900">{c.name || 'Employee'}</span><span className="text-xs text-slate-400">{claimNo(c.id)}</span></div>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Claimed</dt><dd className="text-lg font-extrabold">{inr(c.amount)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expense</dt><dd>{c.category}{c.scan?.vendor ? ` · ${c.scan.vendor}` : ''}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Duplicates</dt><dd className={dup.length ? 'font-bold text-rose-600' : 'font-semibold text-emerald-600'}>{dup.length ? 'Possible' : 'None'}</dd></div>
            </dl>
            {c.description && <p className="mt-2 text-sm text-slate-600">{c.description}</p>}
            {(c.flags || []).length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{c.flags.map((f: any, i: number) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{f.text}</li>)}</ul>}
            {files.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">{files.map((f) => f.id && f.type !== 'application/pdf' ? <div key={f.id} className="overflow-hidden rounded-lg border border-slate-200"><Thumb claimId={c.id} fileId={f.id} /><div className="px-1.5 py-1 text-[10px] font-bold text-slate-500">{f.kind === 'PROOF' ? 'Proof' : 'Bill'}</div></div> : null)}</div>}
            {proof[0]?.takenAt && <p className="mt-2 text-xs text-slate-500">Proof taken {stamp(proof[0].takenAt)}</p>}
            {rejecting === c.id ? (
              <div className="mt-3 space-y-2">
                <textarea rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you rejecting it?" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base" />
                <div className="grid grid-cols-2 gap-2"><button onClick={() => { setRejecting(''); setReason(''); setErr(''); }} className={`${bigBtn} border-2 border-slate-200 bg-white text-slate-700`}>Cancel</button><button disabled={busy === c.id} onClick={() => decide(c, 'REJECT')} className={`${bigBtn} bg-rose-600 text-white`}>Reject</button></div>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2"><button disabled={busy === c.id} onClick={() => decide(c, 'APPROVE')} className={`${bigBtn} bg-emerald-600 text-white`}>{busy === c.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}Approve</button><button onClick={() => { setRejecting(c.id); setErr(''); }} className={`${bigBtn} border-2 border-rose-200 bg-white text-rose-700`}>Reject</button></div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export const ClaimApp: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [tab, setTab] = useState<Tab>('claim');
  const [snap, setSnap] = useState(true); // opens straight to the camera
  const [version, setVersion] = useState(0);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    startAutoSend();
    const up = () => setOffline(false), down = () => setOffline(true);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  const bump = () => setVersion((v) => v + 1);
  const TABS: { id: Tab; label: string; Icon: typeof Camera }[] = [{ id: 'claim', label: 'New claim', Icon: Camera }, { id: 'mine', label: 'My claims', Icon: ClipboardList }, { id: 'approve', label: 'Approve', Icon: ShieldCheck }];
  return (
    <div className="fixed inset-0 flex flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <span className="font-extrabold text-slate-900">Claims</span>
        <button onClick={onLogout} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 active:bg-slate-100"><LogOut className="h-5 w-5" /></button>
      </header>
      {offline && <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900"><WifiOff className="h-4 w-4 shrink-0" />No signal. New claims are saved on your phone.</div>}
      <main className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-4">
        {tab === 'claim' && (
          <div className="space-y-4 pt-2">
            <button onClick={() => setSnap(true)} className={`${bigBtn} bg-[#6d4cf0] py-8 text-xl text-white`}><Camera className="h-8 w-8" />Photograph a bill</button>
            <p className="text-center text-sm text-slate-500">Take a photo, check the details, send. That is all.</p>
            <Waiting onSent={bump} />
          </div>
        )}
        {tab === 'mine' && <div className="space-y-4"><Waiting onSent={bump} /><MyClaimsList version={version} /></div>}
        {tab === 'approve' && <ApproveList />}
      </main>
      <nav className="grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center gap-1 py-3 text-xs font-bold ${tab === id ? 'text-[#6d4cf0]' : 'text-slate-500'}`}><Icon className="h-6 w-6" />{label}</button>
        ))}
      </nav>
      {snap && <QuickClaim inApp onClose={() => setSnap(false)} onSent={() => { bump(); }} onViewClaims={() => { setSnap(false); setTab('mine'); }} />}
    </div>
  );
};
