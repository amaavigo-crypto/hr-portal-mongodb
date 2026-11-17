import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Scale, Sparkles } from 'lucide-react';
import { assistantService, type PolicyClashResult } from '../services/assistantService';

/**
 * For approvers: "Check for clashes". Looks for wording that may disagree with another published policy or with a short
 * list of labour-law reference points. It is only a pointer for the approver to check; it never blocks anything.
 */
export const PolicyClashPanel: React.FC<{ versionId: string }> = ({ versionId }) => {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PolicyClashResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await assistantService.policyClash(versionId);
      if (r.off) setError('The clash check is not switched on for your company.');
      else setRes(r);
    } catch (e: any) {
      setError(e?.message || 'The check could not run right now. Please try again.');
    } finally { setBusy(false); }
  };

  const date = (iso: string) => iso.split('-').reverse().join('/');
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-2">
            <Scale className="w-4 h-4 text-[#FA7014]" /><span>Check for clashes (optional)</span>
          </h3>
          <p className="mt-1 text-xs text-slate-500">Looks for wording that may disagree with your other published policies or with Indian labour law. It only points things out for you to check.</p>
        </div>
        <button type="button" onClick={run} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-[#FA7014] hover:bg-orange-100 disabled:opacity-60 cursor-pointer">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{busy ? 'Checking…' : res ? 'Check again' : 'Run check'}
        </button>
      </div>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {res && (
        <div className="mt-3 space-y-3">
          {res.findings.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="w-4 h-4 shrink-0" />No clashes found against {res.checked.policies} other published {res.checked.policies === 1 ? 'policy' : 'policies'} and {res.checked.lawPoints} labour-law points. This is not a guarantee.</p>
          ) : res.findings.map((f, i) => (
            <div key={i} className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-xs">
              <p className="flex items-start gap-2 font-bold text-slate-900"><AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />{f.issue}</p>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">This policy says</p>
              <blockquote className="border-l-4 border-slate-300 pl-2 text-slate-700">&ldquo;{f.thisText}&rdquo;</blockquote>
              {f.other && (<>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{f.other.title}{f.other.version ? ` (version ${f.other.version})` : ''} says</p>
                <blockquote className="border-l-4 border-slate-300 pl-2 text-slate-700">&ldquo;{f.other.text}&rdquo;</blockquote>
              </>)}
              {f.law && (<>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Labour law reference: {f.law.topic} ({f.law.act})</p>
                <p className="border-l-4 border-slate-300 pl-2 text-slate-700">{f.law.point}</p>
              </>)}
            </div>
          ))}
          <p className="text-[11px] text-slate-500">{res.note} Labour-law points last checked {date(res.lawReviewed)}.</p>
        </div>
      )}
    </div>
  );
};
