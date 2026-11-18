import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { isMuted, setMuted, sfx, subscribeMute, unlockAudio } from './sfx';

/** What every game receives and must call. `payload` is exactly what the server's replay expects for that game. */
export interface GameProps { seed: string; onDone: (payload: any) => void; onQuit: () => void }

export const ACCENT: Record<string, { from: string; to: string; glow: string; soft: string; text: string }> = {
  'fruit-catch': { from: '#ff7a59', to: '#ffb347', glow: 'rgba(255,122,89,.45)', soft: '#fff1ea', text: '#b4421f' },
  'echo-beats': { from: '#7c5cff', to: '#38d5c9', glow: 'rgba(124,92,255,.45)', soft: '#f0ecff', text: '#4b30c9' },
  'fraud-hunter': { from: '#0ea5a4', to: '#4f8cff', glow: 'rgba(14,165,164,.4)', soft: '#e6f8f7', text: '#0b7f7e' },
};

export const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

export function useMuted() { return useSyncExternalStore(subscribeMute, isMuted, isMuted); }

export const SoundToggle: React.FC<{ className?: string; dark?: boolean }> = ({ className = '', dark }) => {
  const m = useMuted();
  return (
    <button type="button" onClick={() => { unlockAudio(); setMuted(!m); if (m) sfx.tick(); }} aria-pressed={!m} aria-label={m ? 'Turn sound on' : 'Turn sound off'} title={m ? 'Sound off' : 'Sound on'}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${dark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} ${className}`}>
      {m ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
};

/** The strip above a game: leave button, a label, progress, score and combo. */
export const Hud: React.FC<{ label: string; progress: number; score: number; combo?: number; onQuit: () => void; accent: string; extra?: React.ReactNode }> = ({ label, progress, score, combo = 0, onQuit, accent, extra }) => {
  const shown = useCountUp(score, 350);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="px-3 pt-3 pb-2 text-white select-none">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setConfirm(true)} aria-label="Leave the game" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"><X className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between text-[11px] font-bold uppercase tracking-wider text-white/70"><span className="truncate">{label}</span>{extra}</div>
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden mt-1"><div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%`, background: accent }} /></div>
        </div>
        <div className="text-right min-w-[64px]">
          <div className="text-lg font-black leading-none tabular-nums">{fmt(shown)}</div>
          <div className={`text-[10px] font-extrabold h-3 transition-opacity ${combo >= 2 ? 'opacity-100' : 'opacity-0'}`} style={{ color: '#ffd166' }}>COMBO ×{(1 + Math.min(combo, 10) * 0.1).toFixed(1)}</div>
        </div>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full text-slate-800 text-center shadow-2xl">
            <p className="font-extrabold text-base">Leave this game?</p>
            <p className="text-sm text-slate-500 mt-1">Your score for this round will not be saved, and it still counts as one of today's plays.</p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-sm">Keep playing</button>
              <button type="button" onClick={onQuit} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-sm">Leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Animates a number up (or down) to a new value. */
export function useCountUp(target: number, ms = 600) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(); const a = from.current; let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = a + (target - a) * e;
      setV(cur); from.current = cur;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** 3, 2, 1, Go. Calls onDone when it ends. */
export const Countdown: React.FC<{ onDone: () => void; accent: string }> = ({ onDone, accent }) => {
  const [n, setN] = useState(3);
  useEffect(() => {
    sfx.tick();
    const id = window.setTimeout(() => {
      if (n > 1) { setN(n - 1); sfx.tick(); } else if (n === 1) { setN(0); sfx.go(); } else onDone();
    }, n === 0 ? 520 : 780);
    return () => window.clearTimeout(id);
  }, [n, onDone]);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-live="assertive">
      <div key={n} className="wb-pop text-white font-black" style={{ fontSize: n === 0 ? 72 : 120, textShadow: `0 8px 40px ${accent}`, letterSpacing: '-0.04em' }}>{n === 0 ? 'GO!' : n}</div>
    </div>
  );
};

/** A full-card message between phases (end of practice, and so on). */
export const Interstitial: React.FC<{ emoji?: string; title: string; text: string; button: string; onClick: () => void; accent: string }> = ({ emoji, title, text, button, onClick, accent }) => (
  <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-black/55 backdrop-blur-[2px]">
    <div className="wb-rise bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl">
      {emoji && <div className="text-5xl mb-2" aria-hidden>{emoji}</div>}
      <h3 className="text-xl font-black text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{text}</p>
      <button type="button" autoFocus onClick={() => { unlockAudio(); onClick(); }} className="mt-5 w-full py-3 rounded-2xl text-white font-extrabold text-sm shadow-lg active:scale-[.98] transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60" style={{ background: accent }}>{button}</button>
    </div>
  </div>
);

/** One burst of confetti over its parent. */
export const Confetti: React.FC<{ run: boolean }> = ({ run }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!run) return;
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d'); if (!g) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr; g.scale(dpr, dpr);
    const cols = ['#ff7a59', '#ffd166', '#38d5c9', '#7c5cff', '#4f8cff', '#ff5d8f'];
    const ps = Array.from({ length: 120 }, () => ({ x: w / 2 + (Math.random() - 0.5) * 80, y: h * 0.38, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[(Math.random() * cols.length) | 0], life: 1 }));
    let raf = 0; let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(2, (now - last) / 16.7); last = now;
      g.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of ps) {
        p.vy += 0.38 * dt; p.vx *= 0.995; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= 0.0045 * dt;
        if (p.life <= 0 || p.y > h + 20) continue;
        alive++;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6)); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore();
      }
      if (alive) raf = requestAnimationFrame(step); else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />;
};

/** Keyframes the games share. Rendered once by the game shell. */
export const GameStyles: React.FC = () => (
  <style>{`
    @keyframes wb-pop { 0% { transform: scale(.4); opacity: 0 } 55% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
    @keyframes wb-rise { 0% { transform: translateY(18px) scale(.97); opacity: 0 } 100% { transform: translateY(0) scale(1); opacity: 1 } }
    @keyframes wb-stamp { 0% { transform: scale(2.4) rotate(-14deg); opacity: 0 } 55% { transform: scale(.94) rotate(-8deg); opacity: 1 } 100% { transform: scale(1) rotate(-8deg); opacity: 1 } }
    @keyframes wb-shake { 10%,90% { transform: translateX(-2px) } 20%,80% { transform: translateX(4px) } 30%,50%,70% { transform: translateX(-6px) } 40%,60% { transform: translateX(6px) } }
    @keyframes wb-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(244,63,94,.55) } 50% { box-shadow: 0 0 0 8px rgba(244,63,94,0) } }
    @keyframes wb-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
    .wb-pop { animation: wb-pop .42s cubic-bezier(.2,.9,.3,1.3) both }
    .wb-rise { animation: wb-rise .4s cubic-bezier(.2,.8,.2,1) both }
    .wb-stamp { animation: wb-stamp .34s cubic-bezier(.2,.9,.3,1.1) both }
    .wb-shake { animation: wb-shake .45s both }
    .wb-pulse { animation: wb-pulse 1s infinite }
    .wb-float { animation: wb-float 3.2s ease-in-out infinite }
    @media (prefers-reduced-motion: reduce) { .wb-pop,.wb-rise,.wb-stamp,.wb-shake,.wb-pulse,.wb-float { animation: none !important } }
  `}</style>
);
