import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { ECHO, echoReplay, echoSequence, type EchoAttempt } from '../../../../shared/wellbeingEngine';
import { ACCENT, GameProps, Hud } from '../common';
import { sfx } from '../sfx';

/**
 * Echo Beats: four glowing pads play a short tune; play it back. Every correct round adds one note and speeds the tune up.
 * Three wrong rounds end the game. Each round is a fresh tune from the seed. The raw taps (which pad, and when) go to the
 * server, which replays the seed and checks every rule before it counts anything.
 */

const PADS = [
  { name: 'Teal triangle', base: '#0f766e', lit: '#2dd4bf', key: ['ArrowUp', 'Digit1', 'KeyW'] },
  { name: 'Coral circle', base: '#b91c3c', lit: '#fb7185', key: ['ArrowRight', 'Digit2', 'KeyD'] },
  { name: 'Amber square', base: '#b45309', lit: '#fbbf24', key: ['ArrowDown', 'Digit3', 'KeyS'] },
  { name: 'Violet diamond', base: '#5b21b6', lit: '#a78bfa', key: ['ArrowLeft', 'Digit4', 'KeyA'] },
];
const C = 200;
const polar = (r: number, a: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)];
function sector(i: number) {
  const mid = (-90 + i * 90) * (Math.PI / 180); const half = 41 * (Math.PI / 180); const ro = 188, ri = 82;
  const [x0, y0] = polar(ro, mid - half), [x1, y1] = polar(ro, mid + half), [x2, y2] = polar(ri, mid + half), [x3, y3] = polar(ri, mid - half);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${ro} ${ro} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} A${ri} ${ri} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)} Z`;
}
const symbolAt = (i: number) => polar(137, (-90 + i * 90) * (Math.PI / 180));
const Symbol: React.FC<{ i: number }> = ({ i }) => {
  const [x, y] = symbolAt(i); const s = 17;
  const common = { fill: 'rgba(255,255,255,.82)' };
  if (i === 0) return <path d={`M${x} ${y - s} L${x + s} ${y + s * 0.8} L${x - s} ${y + s * 0.8} Z`} {...common} />;
  if (i === 1) return <circle cx={x} cy={y} r={s * 0.95} {...common} />;
  if (i === 2) return <rect x={x - s * 0.85} y={y - s * 0.85} width={s * 1.7} height={s * 1.7} rx={4} {...common} />;
  return <path d={`M${x} ${y - s * 1.1} L${x + s * 1.1} ${y} L${x} ${y + s * 1.1} L${x - s * 1.1} ${y} Z`} {...common} />;
};

type Phase = 'show' | 'input' | 'ok' | 'bad' | 'over';

export const EchoBeats: React.FC<GameProps> = ({ seed, onDone, onQuit }) => {
  const acc = ACCENT['echo-beats'];
  const [phase, setPhase] = useState<Phase>('show');
  const [lit, setLit] = useState<number | null>(null);
  const [wrong, setWrong] = useState<number | null>(null);
  const [hint, setHint] = useState<number | null>(null);
  const [len, setLen] = useState<number>(ECHO.startLen);
  const [done, setDone] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [shake, setShake] = useState(0);

  const R = useRef({ k: 0, len: ECHO.startLen as number, strikes: 0, seq: [] as number[], input: [] as number[], t: [] as number[], t0: 0, attempts: [] as EchoAttempt[], phase: 'show' as Phase, streak: 0 });
  const timers = useRef<number[]>([]);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const flash = useCallback((i: number, ms: number) => { sfx.pad(i, ms / 1000 + 0.06); setLit(i); later(() => setLit((cur) => (cur === i ? null : cur)), ms); }, []);

  const finish = useCallback(() => {
    const r = R.current; r.phase = 'over'; setPhase('over'); clearTimers();
    later(() => doneRef.current({ attempts: r.attempts }), 1300);
  }, []);

  const begin = useCallback(() => {
    const r = R.current; clearTimers();
    r.seq = echoSequence(seed, r.k, r.len); r.input = []; r.t = []; r.phase = 'show';
    setPhase('show'); setLen(r.len); setDone(0); setWrong(null); setHint(null);
    const step = Math.max(250, 580 - (r.len - ECHO.startLen) * 32); const dur = Math.round(step * 0.64);
    const lead = 900;
    r.seq.forEach((p, i) => later(() => flash(p, dur), lead + i * step));
    later(() => { r.phase = 'input'; r.t0 = performance.now(); setPhase('input'); armIdle(); }, lead + r.seq.length * step + 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, flash]);

  // If nobody taps for a long while, the round counts as a miss with whatever was played.
  const armIdle = () => {
    const r = R.current; const mark = r.input.length;
    later(() => { if (r.phase === 'input' && r.input.length === mark) fail(null, true); }, 9000);
  };

  const fail = useCallback((pad: number | null, idle = false) => {
    const r = R.current; if (r.phase !== 'input') return;
    r.phase = 'bad'; r.attempts.push({ len: r.len, input: [...r.input], t: [...r.t] }); r.strikes++; r.streak = 0;
    setStrikes(r.strikes); setStreak(0); setWrong(pad); setPhase('bad'); setShake((n) => n + 1);
    if (!idle) sfx.bad();
    setHint((idle ? r.seq[r.input.length] : r.seq[r.input.length - 1]) ?? null);
    r.k++;
    const out = r.strikes >= ECHO.strikes || r.k >= ECHO.maxAttempts;
    later(() => { if (out) finish(); else begin(); }, 1500);
  }, [begin, finish]);

  const tapPad = useCallback((pad: number) => {
    const r = R.current; if (r.phase !== 'input') return;
    const now = performance.now();
    const t = Math.max(0, Math.round(now - r.t0));
    const last = r.t.length ? r.t[r.t.length - 1] : -1000;
    r.input.push(pad); r.t.push(Math.max(t, last + ECHO.minTapGapMs));
    flash(pad, 170);
    const idx = r.input.length - 1;
    if (pad !== r.seq[idx]) { fail(pad); return; }
    setDone(r.input.length);
    if (r.input.length === r.len) {
      r.phase = 'ok'; r.attempts.push({ len: r.len, input: [...r.input], t: [...r.t] });
      r.streak++; setStreak(r.streak);
      const rep = echoReplay(seed, r.attempts); setScore(rep.points);
      later(() => sfx.good(), 120);
      r.k++; r.len++;
      setPhase('ok');
      const out = r.len > ECHO.maxLen || r.k >= ECHO.maxAttempts;
      later(() => { if (out) finish(); else begin(); }, 900);
    } else armIdle();
  }, [seed, flash, fail, begin, finish]);

  useEffect(() => { begin(); return clearTimers; }, [begin]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.repeat) return; const i = PADS.findIndex((p) => p.key.includes(e.code)); if (i >= 0) { e.preventDefault(); tapPad(i); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [tapPad]);

  const hearts = (
    <span className="inline-flex gap-0.5" aria-label={`${ECHO.strikes - strikes} lives left`}>
      {Array.from({ length: ECHO.strikes }, (_, i) => <Heart key={i} className={`w-3.5 h-3.5 transition-all ${i < ECHO.strikes - strikes ? 'text-rose-400 fill-rose-400' : 'text-white/25'}`} />)}
    </span>
  );
  const status = phase === 'show' ? 'Watch' : phase === 'input' ? 'Your turn' : phase === 'ok' ? 'Nice!' : phase === 'bad' ? 'Oops' : 'Done';

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 20%, #241a63 0%, #0d0a2b 70%)' }}>
      <Hud label={`Pattern of ${len}`} progress={Math.min(1, (len - ECHO.startLen) / 8)} score={score} combo={streak >= 3 ? streak : 0} onQuit={onQuit} accent={`linear-gradient(90deg, ${acc.from}, ${acc.to})`} extra={hearts} />
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-6 min-h-[360px]">
        <div key={shake} className={`relative w-full max-w-[420px] aspect-square ${shake ? 'wb-shake' : ''}`}>
          <div className="absolute inset-[-22%] pointer-events-none" style={{ background: `radial-gradient(closest-side, ${lit !== null ? PADS[lit].lit : acc.from}${lit !== null ? '66' : '22'}, transparent)`, transition: 'background .15s' }} />
          <svg viewBox="0 0 400 400" className="relative w-full h-full touch-none select-none" role="group" aria-label="Echo Beats pads">
            <defs>
              <radialGradient id="eb-hub" cx="50%" cy="40%" r="70%"><stop offset="0%" stopColor="#2b2275" /><stop offset="100%" stopColor="#120d3a" /></radialGradient>
            </defs>
            <circle cx={C} cy={C} r={196} fill="#0b0828" stroke="rgba(255,255,255,.08)" strokeWidth={2} />
            {PADS.map((p, i) => {
              const on = lit === i; const bad = wrong === i; const hinted = hint === i && phase === 'bad';
              const fill = bad ? '#ef4444' : on || hinted ? p.lit : p.base;
              return (
                <g key={i} role="button" tabIndex={0} aria-label={p.name} onPointerDown={(e) => { e.preventDefault(); tapPad(i); }}
                  onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); tapPad(i); } }}
                  style={{ cursor: phase === 'input' ? 'pointer' : 'default', transformOrigin: '200px 200px', transform: on ? 'scale(1.025)' : 'scale(1)', transition: 'transform .12s, filter .12s', filter: on || hinted ? `drop-shadow(0 0 22px ${p.lit})` : 'none', outline: 'none' }}>
                  <path d={sector(i)} fill={fill} stroke={fill} strokeWidth={8} strokeLinejoin="round" style={{ transition: 'fill .1s' }} />
                  <path d={sector(i)} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={2} strokeLinejoin="round" transform="translate(0,-2)" opacity={on ? 0.9 : 0.35} />
                  <g opacity={on || hinted ? 1 : 0.7}><Symbol i={i} /></g>
                </g>
              );
            })}
            <circle cx={C} cy={C} r={66} fill="url(#eb-hub)" stroke="rgba(255,255,255,.14)" strokeWidth={2} />
            <text x={C} y={C - 6} textAnchor="middle" fill="#fff" style={{ font: '900 40px ui-sans-serif, system-ui', letterSpacing: '-0.03em' }}>{phase === 'input' ? `${done}/${len}` : len}</text>
            <text x={C} y={C + 24} textAnchor="middle" fill={phase === 'bad' ? '#fda4af' : phase === 'ok' ? '#86efac' : 'rgba(255,255,255,.7)'} style={{ font: '800 13px ui-sans-serif, system-ui', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{status}</text>
          </svg>
        </div>
        <p className="mt-5 text-center text-xs font-semibold text-white/60 h-4" aria-live="polite">
          {phase === 'show' ? 'Watch and listen to the pattern…' : phase === 'input' ? 'Tap the pads in the same order (or press 1 to 4)' : phase === 'bad' ? 'That was not the one. A fresh pattern is coming.' : phase === 'ok' ? 'One more note next time.' : 'Great effort!'}
        </p>
      </div>
    </div>
  );
};
