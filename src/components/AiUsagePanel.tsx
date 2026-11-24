import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { apiJson } from '../services/apiClient';

/** Plain-language names for the AI helpers, so nobody has to read a technical code. */
export const AI_FEATURE_LABELS: Record<string, string> = {
  resume: 'Reading resumes',
  scoring: 'Scoring candidates',
  jd: 'Writing job descriptions',
  assistant: 'Ask HR chat',
  'interview.summary': 'Interview summaries',
  'leave.wording': 'Leave answers',
  'claims.scan': 'Reading bills',
  'claims.category': 'Suggesting claim categories',
  'policy.summary': 'Policy change summaries',
  'policy.clash': 'Policy clash checks',
  'hiring.questions': 'Interview questions',
  'hiring.panel': 'Panel summaries',
  'leave.summary': 'Manager weekly summaries',
};
export const featureLabel = (k: string) => AI_FEATURE_LABELS[k] || k.replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const monthName = (m: string) => { try { return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); } catch { return m; } };

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">{children}</div>
);
const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl bg-slate-50 p-3">
    <div className="text-xs font-semibold text-slate-500">{label}</div>
    <div className="mt-0.5 text-xl font-black text-slate-900">{value}</div>
    {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
  </div>
);
const Loading = () => <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
const ErrorBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{text}</div>
);

/** Company admin view: how much the AI helpers were used this month. No money amounts. */
export const CompanyAiUsage: React.FC = () => {
  const [u, setU] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { apiJson('/api/tenant/ai-usage').then((r: any) => setU(r.usage)).catch((e: Error) => setErr(e.message)); }, []);
  if (err) return <ErrorBox text={err} />;
  if (!u) return <Loading />;
  const pct = u.cap > 0 ? Math.min(100, Math.round((u.used / u.cap) * 100)) : 0;
  const total = u.byFeature.reduce((a: number, f: any) => a + f.calls, 0) || 1;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><Sparkles className="h-4 w-4 text-[#FA7014]" /> AI helpers: {monthName(u.month)}</h2>
        <p className="text-sm text-slate-500">How often the AI helpers were used this month. The count starts again on the 1st.</p>
      </div>
      {!u.enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">AI is switched off for now, so every screen uses its normal non-AI version. Nothing is broken.</div>
      )}
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-bold text-slate-800">Used this month</span>
          <span className="text-sm text-slate-600"><b className="text-slate-900">{u.used}</b> of {u.cap}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI usage this month">
          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-[#FA7014]'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">{pct >= 100 ? 'The limit is reached. AI helpers pause until next month and screens use the normal version.' : `${u.cap - u.used} left this month.`}</p>
      </Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Words read and written" value={fmt(u.inputTokens + u.outputTokens)} hint="in total" />
        <Stat label="Did not work" value={String(u.failed)} hint="screens used the normal version" />
        <Stat label="Helpers used" value={String(u.byFeature.length)} />
      </div>
      <Card>
        <div className="mb-3 text-sm font-bold text-slate-800">What it was used for</div>
        {u.byFeature.length === 0 ? <p className="text-sm text-slate-500">Nothing yet this month.</p> : (
          <ul className="space-y-3">
            {u.byFeature.map((f: any) => (
              <li key={f.feature}>
                <div className="flex justify-between text-sm"><span className="text-slate-800">{featureLabel(f.feature)}</span><span className="text-slate-500">{f.calls} {f.calls === 1 ? 'time' : 'times'}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#FA7014]/70" style={{ width: `${Math.round((f.calls / total) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

/** Platform admin view: every company, with estimated cost. */
export const PlatformAiUsage: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { apiJson('/api/tenant/ai-usage-all').then((r: any) => setRows(r.rows)).catch((e: Error) => setErr(e.message)); }, []);
  if (err) return <ErrorBox text={err} />;
  if (!rows) return <Loading />;
  const months = Array.from(new Set(rows.map((r) => r.month))).sort().reverse();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><Sparkles className="h-4 w-4 text-[#FA7014]" /> AI usage and estimated cost</h2>
        <p className="text-sm text-slate-500">Cost is an estimate from the price list in the code (US dollars). Check your provider's bill for the exact amount.</p>
      </div>
      {rows.length === 0 && <Card><p className="text-sm text-slate-500">No AI has been used yet.</p></Card>}
      {months.map((m) => {
        const list = rows.filter((r) => r.month === m);
        const total = list.reduce((a, r) => a + r.costUsd, 0);
        return (
          <Card key={m}>
            <div className="mb-2 flex items-baseline justify-between"><span className="text-sm font-bold text-slate-800">{monthName(m)}</span><span className="text-sm text-slate-600">Total about <b className="text-slate-900">${total.toFixed(2)}</b></span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-slate-500"><th className="py-1 pr-3 font-semibold">Company</th><th className="py-1 pr-3 font-semibold">Calls</th><th className="py-1 pr-3 font-semibold">Failed</th><th className="py-1 pr-3 font-semibold">Words</th><th className="py-1 font-semibold">Cost</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.companyId + r.month} className="border-t border-slate-100"><td className="py-1.5 pr-3 text-slate-800">{r.company}</td><td className="py-1.5 pr-3">{r.calls}</td><td className="py-1.5 pr-3">{r.failed}</td><td className="py-1.5 pr-3">{fmt(r.inputTokens + r.outputTokens)}</td><td className="py-1.5">${r.costUsd.toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
