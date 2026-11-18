import React from 'react';
import type { GameId } from '../../../shared/wellbeingEngine';

/** Small illustrations used on game cards and intro screens. Plain SVG, no image files. */
export const GameArt: React.FC<{ game: GameId; className?: string }> = ({ game, className = '' }) => {
  if (game === 'fruit-catch') return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <defs>
        <radialGradient id="ga-ap" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#ff8a80" /><stop offset=".6" stopColor="#e53935" /><stop offset="1" stopColor="#9f1414" /></radialGradient>
        <radialGradient id="ga-or" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#ffcc80" /><stop offset=".6" stopColor="#fb8c00" /><stop offset="1" stopColor="#d84315" /></radialGradient>
        <radialGradient id="ga-bm" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#6b7280" /><stop offset=".5" stopColor="#1f2937" /><stop offset="1" stopColor="#030712" /></radialGradient>
      </defs>
      <g className="wb-float"><circle cx="48" cy="52" r="26" fill="url(#ga-ap)" /><path d="M48 28 q4 -12 14 -14" stroke="#5d3a1a" strokeWidth="4" fill="none" strokeLinecap="round" /><path d="M52 30 q14 -14 26 -4 q-12 10 -26 4z" fill="#43a047" /><ellipse cx="38" cy="44" rx="4.5" ry="8" fill="#fff" opacity=".35" transform="rotate(-25 38 44)" /></g>
      <g className="wb-float" style={{ animationDelay: '-1.2s' }}><circle cx="112" cy="40" r="20" fill="url(#ga-or)" /><circle cx="112" cy="21" r="3" fill="#558b2f" /><ellipse cx="105" cy="33" rx="3.5" ry="6" fill="#fff" opacity=".35" transform="rotate(-25 105 33)" /></g>
      <g className="wb-float" style={{ animationDelay: '-2.2s' }}><circle cx="92" cy="92" r="20" fill="url(#ga-bm)" /><rect x="84" y="66" width="16" height="9" rx="3" fill="#4b5563" /><path d="M92 66 q10 -12 20 -8" stroke="#a16207" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="112" cy="58" r="5" fill="#ffd166" /><circle cx="85" cy="92" r="3.2" fill="#fff" /><circle cx="99" cy="92" r="3.2" fill="#fff" /><path d="M80 85 l9 4 M104 85 l-9 4" stroke="#ff4d6d" strokeWidth="3" strokeLinecap="round" /></g>
    </svg>
  );
  if (game === 'echo-beats') {
    const pad = (a0: number, a1: number, c: string) => {
      const p = (r: number, a: number) => `${80 + r * Math.cos((a * Math.PI) / 180)} ${60 + r * Math.sin((a * Math.PI) / 180)}`;
      return <path d={`M${p(52, a0)} A52 52 0 0 1 ${p(52, a1)} L${p(22, a1)} A22 22 0 0 0 ${p(22, a0)} Z`} fill={c} stroke={c} strokeWidth="4" strokeLinejoin="round" />;
    };
    return (
      <svg viewBox="0 0 160 120" className={className} aria-hidden>
        <circle cx="80" cy="60" r="56" fill="#0b0828" opacity=".55" />
        {pad(-130, -50, '#2dd4bf')}{pad(-40, 40, '#fb7185')}{pad(50, 130, '#fbbf24')}{pad(140, 220, '#a78bfa')}
        <circle cx="80" cy="60" r="17" fill="#241a63" />
        <path d="M74 54 v12 l11 -6z" fill="#fff" opacity=".85" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <g transform="rotate(-6 70 60)"><rect x="34" y="12" width="76" height="98" rx="8" fill="#fff" /><rect x="34" y="12" width="76" height="9" rx="4" fill="#0ea5a4" />
        {[0, 1, 2, 3].map((i) => <g key={i}><rect x="42" y={30 + i * 14} width="30" height="5" rx="2.5" fill="#cbd5e1" /><rect x="84" y={30 + i * 14} width="18" height="5" rx="2.5" fill={i === 2 ? '#f43f5e' : '#94a3b8'} /></g>)}
        <rect x="42" y="92" width="60" height="7" rx="3.5" fill="#e2e8f0" /></g>
      <g className="wb-float"><circle cx="104" cy="76" r="22" fill="rgba(255,255,255,.28)" stroke="#fff" strokeWidth="6" /><path d="M120 92 l18 18" stroke="#fff" strokeWidth="9" strokeLinecap="round" /><path d="M95 76 l7 7 l13 -14" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
    </svg>
  );
};
