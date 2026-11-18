import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { FRAUD, FRAUD_TARGETS, fraudOutcome, fraudPlan, fraudStep, type FraudDoc, type FraudOutcome, type FraudResult } from '../../../../shared/wellbeingEngine';
import { ACCENT, GameProps, Hud, Interstitial } from '../common';
import { sfx } from '../sfx';

/**
 * Fraud Hunter: each invoice has either one line that does not add up, or none. Tap the wrong line, or press "All clear".
 * 3 practice invoices, then 24 that count, each with a 25 second timer. The server rebuilds the same invoices from the seed
 * and judges every answer itself.
 */

const rupee = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const STAMPS: Record<FraudOutcome, { text: string; color: string }> = {
  found: { text: 'Caught!', color: '#059669' },
  cleared: { text: 'All clear', color: '#2563eb' },
  wrongSpot: { text: 'Wrong line', color: '#dc2626' },
  falseAlarm: { text: 'It was clean', color: '#dc2626' },
  missed: { text: 'Missed it', color: '#d97706' },
};

/** Why the faulty line is faulty, in plain words. */
function explain(d: FraudDoc): string {
  if (d.errorAt < 0) return 'Every line on this invoice adds up.';
  if (d.errorAt < FRAUD.rows) { const r = d.rows[d.errorAt]; return `${r.qty} × ${rupee(r.rate)} = ${rupee(r.qty * r.rate)}, but the line says ${rupee(r.amount)}.`; }
  const sum = d.rows.reduce((a, r) => a + r.amount, 0);
  if (d.errorAt === FRAUD_TARGETS.subtotal) return `The lines add up to ${rupee(sum)}, but the subtotal says ${rupee(d.subtotal)}.`;
  if (d.errorAt === FRAUD_TARGETS.gst) return `${d.gstRate}% of ${rupee(d.subtotal)} is ${rupee(Math.round((d.subtotal * d.gstRate) / 100))}, but GST says ${rupee(d.gst)}.`;
  return `${rupee(d.subtotal)} + ${rupee(d.gst)} = ${rupee(d.subtotal + d.gst)}, but the total says ${rupee(d.total)}.`;
}

/** A tappable line of the invoice. Defined outside the game so the timer ticking never rebuilds it mid-tap. */
const Row: React.FC<{ idx: number; disabled: boolean; tone: string; onPick: (idx: number) => void; children: React.ReactNode; className?: string }> = ({ idx, disabled, tone, onPick, children, className = '' }) => (
  <button type="button" disabled={disabled} onClick={() => onPick(idx)} className={`w-full text-left rounded-lg transition-colors ${tone} ${className}`}>{children}</button>
);

function practiceDocs(seed: string): FraudDoc[] {
  for (let t = 0; t < 12; t++) {
    const plan = fraudPlan(`${seed}:practice${t}`, 10);
    const errs = plan.filter((d) => d.errorAt >= 0 && d.errorAt < FRAUD.rows); const clean = plan.find((d) => d.errorAt === -1);
    if (errs.length >= 2 && clean) return [errs[0], clean, errs[1]];
  }
  return fraudPlan(`${seed}:practice`, FRAUD.practice);
}

export const FraudHunter: React.FC<GameProps> = ({ seed, onDone, onQuit }) => {
  const acc = ACCENT['fraud-hunter'];
  const real = useMemo(() => fraudPlan(seed), [seed]);
  const prac = useMemo(() => practiceDocs(seed), [seed]);
  const [stage, setStage] = useState<'practice' | 'between' | 'real'>('practice');
  const plan = stage === 'practice' ? prac : real;
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'reveal'>('ask');
  const [outcome, setOutcome] = useState<FraudOutcome | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gain, setGain] = useState(0);
  const [left, setLeft] = useState(1);
  const results = useRef<FraudResult[]>([]);
  const t0 = useRef(performance.now());
  const paused = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const locked = useRef(false);
  const nextTimer = useRef<number | undefined>(undefined);
  const doneRef = useRef(onDone); doneRef.current = onDone;

  const doc = plan[Math.min(i, plan.length - 1)];

  const startDoc = useCallback(() => { t0.current = performance.now(); paused.current = 0; locked.current = false; setPhase('ask'); setOutcome(null); setChosen(null); setLeft(1); }, []);

  const advance = useCallback((from: number) => {
    window.clearTimeout(nextTimer.current);
    const n = from + 1;
    if (n >= plan.length) {
      if (stage === 'practice') setStage('between');
      else doneRef.current({ results: results.current });
      return;
    }
    setI(n); startDoc();
  }, [plan.length, stage, startDoc]);

  const answer = useCallback((choice: number | null) => {
    if (locked.current || phase !== 'ask') return;
    locked.current = true;
    const ms = Math.min(FRAUD.timeoutMs, Math.max(0, Math.round(performance.now() - t0.current - paused.current)));
    const res: FraudResult = { choice, ms };
    const o = fraudOutcome(doc, res); const step = fraudStep(o, ms, combo);
    if (stage === 'real') results.current.push(res);
    setChosen(choice); setOutcome(o); setPhase('reveal'); setScore((s) => s + step.points); setCombo(step.combo); setGain(step.points);
    if (o === 'found' || o === 'cleared') sfx.stamp(); else sfx.bad();
    if (o === 'found' || o === 'cleared') window.setTimeout(() => sfx.good(), 150);
    const hold = o === 'found' || o === 'cleared' ? (stage === 'practice' ? 1500 : 850) : stage === 'practice' ? 3400 : 2300;
    const idx = i;
    nextTimer.current = window.setTimeout(() => advance(idx), hold);
  }, [advance, combo, doc, i, phase, stage]);

  // the clock for this invoice (time away from the tab does not count)
  useEffect(() => {
    if (phase !== 'ask' || stage === 'between') return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const used = performance.now() - t0.current - paused.current;
      setLeft(Math.max(0, 1 - used / FRAUD.timeoutMs));
      if (used >= FRAUD.timeoutMs) answer(null);
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, stage, i, answer]);
  useEffect(() => {
    const vis = () => { if (document.hidden) hiddenAt.current = performance.now(); else if (hiddenAt.current !== null) { paused.current += performance.now() - hiddenAt.current; hiddenAt.current = null; } };
    document.addEventListener('visibilitychange', vis); return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  useEffect(() => () => window.clearTimeout(nextTimer.current), []);
  useEffect(() => { if (stage === 'real') { setI(0); setScore(0); setCombo(0); results.current = []; startDoc(); } }, [stage, startDoc]);

  // keys: 0 for all clear
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === '0' || e.key === 'c') answer(-1); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [answer]);

  const revealing = phase === 'reveal';
  const rowTone = (idx: number) => {
    if (!revealing) return 'hover:bg-teal-50 active:bg-teal-100 cursor-pointer';
    if (idx === doc.errorAt) return outcome === 'found' ? 'bg-emerald-100 ring-2 ring-emerald-500' : 'bg-amber-100 ring-2 ring-amber-500 wb-pulse';
    if (idx === chosen) return 'bg-rose-100 ring-2 ring-rose-400 line-through decoration-rose-400';
    return 'opacity-60';
  };
  const rp = (idx: number) => ({ idx, disabled: revealing, tone: rowTone(idx), onPick: answer });
  const stamp = outcome ? STAMPS[outcome] : null;
  const practice = stage === 'practice';

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: 'radial-gradient(120% 80% at 50% 0%, #0f4f5c 0%, #07242c 75%)' }}>
      <Hud label={practice ? `Practice ${Math.min(i + 1, plan.length)} of ${plan.length}` : `Invoice ${Math.min(i + 1, plan.length)} of ${plan.length}`} progress={plan.length ? i / plan.length : 0} score={score} combo={combo} onQuit={onQuit} accent={`linear-gradient(90deg, ${acc.from}, ${acc.to})`}
        extra={practice ? <span className="text-amber-300">Does not count</span> : undefined} />
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mx-auto max-w-[460px]">
          <p className="text-center text-[11px] font-semibold text-teal-100/80 mb-2">
            {practice ? 'Check each line: quantity × rate = amount, the lines add up to the subtotal, then GST, then the total.' : 'One line may be wrong, or none. Tap the wrong line, or press All clear.'}
          </p>
          <div key={`${stage}${i}`} className="relative wb-rise bg-white rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
            <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${acc.from}, ${acc.to})` }} />
            {!revealing && <div className="h-1 bg-slate-100"><div className="h-full transition-[width] duration-100 ease-linear" style={{ width: `${left * 100}%`, background: left > 0.3 ? acc.from : '#f43f5e' }} /></div>}
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl text-white font-black flex items-center justify-center shrink-0" style={{ background: `linear-gradient(135deg, ${acc.from}, ${acc.to})` }}>{doc.vendor[0]}</div>
                  <div className="min-w-0"><div className="font-extrabold text-slate-900 leading-tight truncate">{doc.vendor}</div><div className="text-[10px] font-bold tracking-widest text-slate-400">TAX INVOICE</div></div>
                </div>
                <div className="text-right text-[11px] text-slate-500 leading-tight shrink-0"><div className="font-bold text-slate-700">{doc.invoiceNo}</div><div>{doc.date}</div></div>
              </div>
              <div className="grid grid-cols-[1fr_44px_64px_84px] gap-x-2 mt-3 px-2 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                <span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
              </div>
              <div className="mt-1 space-y-0.5 tabular-nums">
                {doc.rows.map((r, idx) => (
                  <Row key={idx} {...rp(idx)} className="grid grid-cols-[1fr_44px_64px_84px] gap-x-2 px-2 py-2.5 text-[13px] text-slate-800">
                    <span className="truncate font-medium">{r.item}</span><span className="text-right">{r.qty}</span><span className="text-right">{r.rate.toLocaleString('en-IN')}</span><span className="text-right font-bold">{r.amount.toLocaleString('en-IN')}</span>
                  </Row>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-dashed border-slate-300 space-y-0.5 tabular-nums">
                <Row {...rp(FRAUD_TARGETS.subtotal)} className="flex justify-between px-2 py-2.5 text-[13px] text-slate-700"><span>Subtotal</span><span className="font-bold">{rupee(doc.subtotal)}</span></Row>
                <Row {...rp(FRAUD_TARGETS.gst)} className="flex justify-between px-2 py-2.5 text-[13px] text-slate-700"><span>GST @ {doc.gstRate}%</span><span className="font-bold">{rupee(doc.gst)}</span></Row>
                <Row {...rp(FRAUD_TARGETS.total)} className="flex justify-between px-2 py-3 text-[15px] text-slate-900 font-black bg-slate-50"><span>Total</span><span>{rupee(doc.total)}</span></Row>
              </div>
              {revealing && (
                <div className="mt-3 rounded-xl px-3 py-2.5 bg-slate-100 wb-rise flex items-center gap-3">
                  {stamp && <span className="wb-stamp shrink-0 border-[3px] rounded-md px-2 py-0.5 font-black uppercase tracking-wide text-[13px] bg-white" style={{ color: stamp.color, borderColor: stamp.color }}>{stamp.text}</span>}
                  <span className="text-[12.5px] font-semibold text-slate-700 leading-snug">{explain(doc)}{gain > 0 && <span className="ml-1.5 text-emerald-700 font-extrabold">+{gain}</span>}</span>
                </div>
              )}
            </div>
          </div>
          <button type="button" disabled={revealing} onClick={() => answer(-1)}
            className="mt-3 w-full py-3.5 rounded-2xl font-extrabold text-sm text-white shadow-lg shadow-black/30 active:scale-[.98] transition-transform disabled:opacity-50 inline-flex items-center justify-center gap-2" style={{ background: `linear-gradient(135deg, ${acc.from}, ${acc.to})` }}>
            <Check className="w-4 h-4" /> All clear, nothing wrong
          </button>
        </div>
      </div>
      {stage === 'between' && <Interstitial emoji="🔎" title="Practice done" text={`Now ${FRAUD.docs} invoices that count. Each has a 25 second timer. A quick, correct answer scores more.`} button="Start the real round" onClick={() => setStage('real')} accent={`linear-gradient(135deg, ${acc.from}, ${acc.to})`} />}
    </div>
  );
};
