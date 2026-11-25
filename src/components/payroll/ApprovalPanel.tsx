import React, { useCallback, useEffect, useState } from 'react';
import { payrollService } from '../../services/payrollService';
import { Card, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const NEXT_LABEL: Record<string, string> = { HR: 'Verify as HR', FINANCE: 'Verify as Finance', SIGNATORY: 'Authorise payroll' };

/** Calendar (cut-off, freeze) and the three-step approval. Shown only when the company has turned either on. `onChanged` reloads the run. */
export const ApprovalPanel: React.FC<{ month: string; status: string; canManage: boolean; reloadKey: string; onChanged: () => Promise<void>; onChain: (on: boolean) => void }> = ({ month, status, canManage, reloadKey, onChanged, onChain }) => {
  const [cal, setCal] = useState<any | null>(null);
  const [ap, setAp] = useState<any | null>(null);
  const [note, setNoteText] = useState('');
  const [reason, setReason] = useState('');
  const { busy, note: msg, run } = useRunner();

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([payrollService.calendar(month), payrollService.approvalState(month)]);
      setCal(c); setAp(a); onChain(!!a.enabled);
    } catch { setCal(null); setAp(null); onChain(false); }
  }, [month, onChain]);
  useEffect(() => { load(); }, [load, reloadKey, status]);

  const showCal = cal?.enabled;
  const showAp = ap?.enabled;
  if (!showCal && !showAp) return null;
  const draft = status === 'DRAFT';
  const frozen = cal?.status === 'FROZEN';

  const act = (fn: () => Promise<any>, done: string) => run(async () => { try { await fn(); } finally { await load(); await onChanged(); } }, done);

  return (
    <div className="space-y-3">
      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice>}
      {showCal && (
        <Card title="Payroll calendar" subtitle={`Inputs cut-off ${cal.cutoff} · salary day ${cal.payDate}`}
          right={<span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${frozen ? 'bg-sky-50 border-sky-200 text-sky-800' : 'bg-white border-slate-200 text-slate-600'}`}>{frozen ? 'Inputs frozen' : 'Inputs open'}</span>}>
          {cal.warning && <Notice tone="warn">{cal.warning}</Notice>}
          <div className="text-xs text-slate-600 mb-2">Stage: <b>{cal.stage.replace(/_/g, ' ').toLowerCase()}</b>{frozen && cal.frozenBy ? ` · frozen by ${cal.frozenBy}` : ''}. While frozen, adjustments and attendance overrides for this month are refused.</div>
          {canManage && draft && (
            <div className="flex flex-wrap items-center gap-2">
              {!frozen && <button className={btnPrimary} disabled={busy} onClick={() => act(() => payrollService.freezeMonth(month), 'Inputs frozen.')}>Freeze inputs</button>}
              {frozen && <>
                <input className={`${input} w-72`} placeholder="Reason for unfreezing (kept on record)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className={btnGhost} disabled={busy || !reason.trim()} onClick={() => act(() => payrollService.unfreezeMonth(month, reason).then(() => setReason('')), 'Unfrozen. Earlier approvals were cleared.')}>Unfreeze</button>
              </>}
            </div>
          )}
          {cal.log?.length > 0 && <ul className="mt-2 text-[11px] text-slate-500 space-y-0.5">{cal.log.slice(-4).map((l: any, i: number) => <li key={i}>{l.at.slice(0, 16).replace('T', ' ')} · {l.action.toLowerCase()} by {l.by}{l.note ? ` · ${l.note}` : ''}</li>)}</ul>}
        </Card>
      )}
      {showAp && ap.steps?.length > 0 && (
        <Card title="Approval" subtitle="Three people, in order. Each approves the exact figures shown; any change clears the approvals.">
          <ol className="space-y-2">
            {ap.steps.map((s: any) => (
              <li key={s.step} className="flex flex-wrap items-center gap-3 text-xs">
                <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold ${s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{s.done ? '✓' : ''}</span>
                <span className="font-semibold w-44">{s.label}</span>
                {s.done ? <span className="text-slate-600">{s.done.by} · {s.done.at.slice(0, 16).replace('T', ' ')}{s.done.note ? ` · ${s.done.note}` : ''}</span>
                  : ap.next === s.step && draft ? (s.problem ? <span className="text-slate-500">{s.problem}</span> : <>
                    <input className={`${input} w-56`} placeholder="Note (optional)" value={note} onChange={(e) => setNoteText(e.target.value)} />
                    <button className={btnPrimary} disabled={busy} onClick={() => act(async () => {
                      try { await payrollService.approvalStep({ month, step: s.step, expectedHash: ap.hash, note }); }
                      catch (e: any) {
                        if (String(e.message).includes('has not ended') && window.confirm('This month has not ended yet. Days still to come will be paid in full. Continue?')) await payrollService.approvalStep({ month, step: s.step, expectedHash: ap.hash, note, force: true });
                        else throw e;
                      }
                      setNoteText('');
                    }, 'Recorded.')}>{NEXT_LABEL[s.step]}</button>
                  </>) : <span className="text-slate-400">Waiting</span>}
              </li>
            ))}
          </ol>
          {ap.hash && <div className="mt-2 text-[10px] text-slate-400 font-mono">Run fingerprint {ap.hash.slice(0, 16)}</div>}
        </Card>
      )}
    </div>
  );
};
