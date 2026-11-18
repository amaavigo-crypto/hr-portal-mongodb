import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FRUIT, fruitOutcome, fruitPlan, fruitStep, type FruitResult, type FruitTrial } from '../../../../shared/wellbeingEngine';
import { ACCENT, GameProps, Hud, Interstitial } from '../common';
import { sfx } from '../sfx';

/**
 * Fruit Catch: one item at a time falls down one of five lanes. Tap (or press Space) for fruit, leave the bombs alone.
 * 6 practice items, then 60 that count. The time from the item appearing to the tap is measured with the browser's own
 * event clock; the server replays the seed and works out points and skills from the raw taps.
 */

type Fx = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'dot' | 'ring' | 'spark' };
type Float = { x: number; y: number; text: string; color: string; life: number; size: number };
interface Run { plan: FruitTrial[]; practice: boolean; i: number; st: 'isi' | 'fall' | 'end'; nextAt: number; spawnT: number; tapped: boolean; results: FruitResult[]; score: number; combo: number; finished: boolean }

const FRUIT_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#8e24aa', '#ef476f'];
const PRACTICE_GO = [true, true, false, true, false, true];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// Event timestamps are on the same clock as performance.now(); a few old browsers use the epoch instead.
const clock = (ts: number) => (ts > 1e11 || ts <= 0 ? performance.now() : ts);

// ---------------------------------------------------------------- vector art (drawn around 0,0 with radius r)
function leaf(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  g.save(); g.translate(x, y); g.rotate(rot);
  const gr = g.createLinearGradient(0, 0, r * 0.9, 0); gr.addColorStop(0, '#2e7d32'); gr.addColorStop(1, '#7cb342');
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(r * 0.4, -r * 0.45, r * 0.9, -r * 0.1); g.quadraticCurveTo(r * 0.45, r * 0.3, 0, 0); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = r * 0.03; g.beginPath(); g.moveTo(0, 0); g.lineTo(r * 0.75, -r * 0.1); g.stroke();
  g.restore();
}
function shine(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = -0.5) {
  g.fillStyle = 'rgba(255,255,255,.38)'; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill();
}
function drawFruit(g: CanvasRenderingContext2D, kind: number, r: number) {
  switch (kind % 5) {
    case 0: { // apple
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.05);
      gr.addColorStop(0, '#ff8a80'); gr.addColorStop(0.55, '#e53935'); gr.addColorStop(1, '#9f1414');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -r * 0.7);
      g.bezierCurveTo(r * 0.55, -r * 1.05, r * 1.1, -r * 0.45, r * 0.95, r * 0.2);
      g.bezierCurveTo(r * 0.8, r * 0.85, r * 0.35, r * 1.0, 0, r * 0.85);
      g.bezierCurveTo(-r * 0.35, r * 1.0, -r * 0.8, r * 0.85, -r * 0.95, r * 0.2);
      g.bezierCurveTo(-r * 1.1, -r * 0.45, -r * 0.55, -r * 1.05, 0, -r * 0.7); g.fill();
      g.strokeStyle = '#5d3a1a'; g.lineWidth = r * 0.1; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -r * 0.68); g.quadraticCurveTo(r * 0.05, -r * 1.0, r * 0.2, -r * 1.12); g.stroke();
      leaf(g, r * 0.08, -r * 0.88, r * 0.9, -0.5); shine(g, -r * 0.45, -r * 0.2, r * 0.15, r * 0.27);
      break;
    }
    case 1: { // orange
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#ffcc80'); gr.addColorStop(0.5, '#fb8c00'); gr.addColorStop(1, '#d84315');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.95, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(150,50,0,.22)';
      for (let i = 0; i < 14; i++) { const a = i * 2.4; const d = (0.2 + ((i * 37) % 60) / 100) * r * 0.8; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.03, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#558b2f'; g.beginPath(); g.arc(0, -r * 0.9, r * 0.1, 0, Math.PI * 2); g.fill();
      leaf(g, 0, -r * 0.9, r * 0.8, -0.3); shine(g, -r * 0.4, -r * 0.35, r * 0.16, r * 0.26);
      break;
    }
    case 2: { // lemon
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.25, r * 0.1, 0, 0, r * 1.2);
      gr.addColorStop(0, '#fff59d'); gr.addColorStop(0.55, '#fdd835'); gr.addColorStop(1, '#f9a825');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-r * 1.15, r * 0.02);
      g.bezierCurveTo(-r * 0.85, -r * 0.95, r * 0.85, -r * 0.95, r * 1.15, -r * 0.02);
      g.bezierCurveTo(r * 0.85, r * 0.95, -r * 0.85, r * 0.95, -r * 1.15, r * 0.02); g.fill();
      g.fillStyle = '#f9a825'; g.beginPath(); g.arc(-r * 1.14, r * 0.02, r * 0.07, 0, Math.PI * 2); g.arc(r * 1.14, -r * 0.02, r * 0.07, 0, Math.PI * 2); g.fill();
      leaf(g, r * 0.1, -r * 0.62, r * 0.8, -0.7); shine(g, -r * 0.4, -r * 0.3, r * 0.3, r * 0.1, -0.2);
      break;
    }
    case 3: { // grapes
      const pts: [number, number][] = [[-0.52, -0.25], [0, -0.3], [0.52, -0.25], [-0.26, 0.2], [0.26, 0.2], [0, 0.68], [-0.0, 0.18]];
      for (const [px, py] of pts) {
        const gr = g.createRadialGradient(px * r - r * 0.1, py * r - r * 0.1, r * 0.04, px * r, py * r, r * 0.34);
        gr.addColorStop(0, '#d1a3ff'); gr.addColorStop(0.6, '#8e24aa'); gr.addColorStop(1, '#4a148c');
        g.fillStyle = gr; g.beginPath(); g.arc(px * r, py * r, r * 0.33, 0, Math.PI * 2); g.fill();
        shine(g, px * r - r * 0.1, py * r - r * 0.1, r * 0.06, r * 0.1);
      }
      g.strokeStyle = '#5d4037'; g.lineWidth = r * 0.09; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -r * 0.5); g.lineTo(r * 0.05, -r * 0.95); g.stroke();
      leaf(g, r * 0.05, -r * 0.8, r * 0.85, -0.6);
      break;
    }
    default: { // strawberry
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.2, r * 0.1, 0, 0, r * 1.1);
      gr.addColorStop(0, '#ff8fab'); gr.addColorStop(0.55, '#ef476f'); gr.addColorStop(1, '#a4133c');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, r * 1.0);
      g.bezierCurveTo(-r * 0.4, r * 0.85, -r * 1.05, r * 0.2, -r * 0.95, -r * 0.35);
      g.bezierCurveTo(-r * 0.85, -r * 0.8, -r * 0.2, -r * 0.8, 0, -r * 0.6);
      g.bezierCurveTo(r * 0.2, -r * 0.8, r * 0.85, -r * 0.8, r * 0.95, -r * 0.35);
      g.bezierCurveTo(r * 1.05, r * 0.2, r * 0.4, r * 0.85, 0, r * 1.0); g.fill();
      g.fillStyle = '#ffe082';
      for (let i = 0; i < 12; i++) { const x = (((i * 53) % 100) / 100 - 0.5) * r * 1.3; const y = (((i * 29) % 100) / 100 - 0.25) * r * 1.2; if (Math.abs(x) < r * (0.95 - Math.max(0, y) * 0.6)) { g.beginPath(); g.ellipse(x, y, r * 0.04, r * 0.07, 0.3, 0, Math.PI * 2); g.fill(); } }
      g.fillStyle = '#43a047'; g.beginPath();
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.62; g.moveTo(0, -r * 0.62); g.quadraticCurveTo(Math.cos(a) * r * 0.4, -r * 0.62 + Math.sin(a) * r * 0.2 - r * 0.1, Math.cos(a) * r * 0.62, -r * 0.55 + Math.sin(a) * r * 0.3); g.quadraticCurveTo(Math.cos(a) * r * 0.3, -r * 0.5, 0, -r * 0.62); }
      g.fill(); g.strokeStyle = '#2e7d32'; g.lineWidth = r * 0.08; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -r * 0.62); g.lineTo(0, -r * 0.95); g.stroke();
      shine(g, -r * 0.42, -r * 0.1, r * 0.12, r * 0.24, -0.3);
    }
  }
}
function drawBomb(g: CanvasRenderingContext2D, r: number, t: number) {
  const danger = 0.5 + 0.5 * Math.sin(t / 130);
  g.save(); g.shadowColor = `rgba(255,40,60,${0.5 + danger * 0.4})`; g.shadowBlur = r * 0.9;
  const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r);
  gr.addColorStop(0, '#6b7280'); gr.addColorStop(0.45, '#1f2937'); gr.addColorStop(1, '#030712');
  g.fillStyle = gr; g.beginPath(); g.arc(0, r * 0.1, r * 0.92, 0, Math.PI * 2); g.fill(); g.restore();
  // cap and fuse
  g.fillStyle = '#4b5563'; g.beginPath(); g.roundRect(-r * 0.28, -r * 0.98, r * 0.56, r * 0.3, r * 0.08); g.fill();
  g.strokeStyle = '#a16207'; g.lineWidth = r * 0.09; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -r * 0.98); g.quadraticCurveTo(r * 0.3, -r * 1.25, r * 0.55, -r * 1.12); g.stroke();
  // spark
  const sx = r * 0.55, sy = -r * 1.12; const f = 0.75 + 0.25 * Math.sin(t / 45);
  g.fillStyle = '#ffd166'; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + t / 200; const rr = (i % 2 ? r * 0.1 : r * 0.28) * f; g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, r * 0.06, 0, Math.PI * 2); g.fill();
  // warning face
  g.strokeStyle = `rgba(255,70,90,${0.7 + danger * 0.3})`; g.lineWidth = r * 0.11; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.4, -r * 0.05); g.lineTo(-r * 0.12, r * 0.12); g.moveTo(r * 0.4, -r * 0.05); g.lineTo(r * 0.12, r * 0.12); g.stroke();
  g.beginPath(); g.arc(0, r * 0.62, r * 0.26, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  shine(g, -r * 0.4, -r * 0.3, r * 0.1, r * 0.2);
}

export const FruitCatch: React.FC<GameProps> = ({ seed, onDone, onQuit }) => {
  const acc = ACCENT['fruit-catch'];
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 360, h: 520, dpr: 1 });
  const runRef = useRef<Run | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const floatsRef = useRef<Float[]>([]);
  const shakeRef = useRef(0);
  const flashRef = useRef<{ c: string; a: number }>({ c: '#f43f5e', a: 0 });
  const rippleRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const hiddenAt = useRef<number | null>(null);
  const [stage, setStage] = useState<'practice' | 'between' | 'real'>('practice');
  const [hud, setHud] = useState<{ score: number; combo: number; i: number; n: number }>({ score: 0, combo: 0, i: 0, n: FRUIT.practice });
  const doneRef = useRef(onDone); doneRef.current = onDone;

  const makeRun = useCallback((practice: boolean): Run => {
    const plan = practice ? fruitPlan(`${seed}:practice`, FRUIT.practice).map((t, i) => ({ ...t, go: PRACTICE_GO[i] ?? t.go })) : fruitPlan(seed);
    return { plan, practice, i: 0, st: 'isi', nextAt: performance.now() + 900, spawnT: 0, tapped: false, results: [], score: 0, combo: 0, finished: false };
  }, [seed]);

  // size the canvas to its box
  useEffect(() => {
    const el = wrap.current, c = cv.current; if (!el || !c) return;
    const fit = () => {
      const w = Math.max(280, Math.min(560, el.clientWidth)); const h = Math.max(340, el.clientHeight);
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      sizeRef.current = { w, h, dpr }; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px`;
    };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);

  const burst = useCallback((x: number, y: number, color: string, n: number, power = 1) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const s = (2 + Math.random() * 5) * power;
      fxRef.current.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1, max: 600 + Math.random() * 500, size: 3 + Math.random() * 5, color, kind: 'dot' });
    }
    fxRef.current.push({ x, y, vx: 0, vy: 0, life: 1, max: 420, size: 10, color, kind: 'ring' });
  }, []);

  const itemPos = (run: Run, now: number) => {
    const { w, h } = sizeRef.current; const laneW = w / FRUIT.lanes; const r = Math.min(laneW * 0.44, 54);
    const p = clamp01((now - run.spawnT) / FRUIT.fallMs);
    return { x: (run.plan[run.i].lane + 0.5) * laneW, y: -r + (h + r * 2) * Math.pow(p, 1.12), r };
  };

  const resolve = useCallback((run: Run, now: number, res: FruitResult) => {
    const trial = run.plan[run.i];
    const o = fruitOutcome(trial, res);
    const step = fruitStep(o, res.rt, run.combo);
    const pos = itemPos(run, now);
    const x = pos.x; const y = res.tapped ? pos.y : Math.min(pos.y, sizeRef.current.h - 40);
    const color = FRUIT_COLORS[trial.kind % 5];
    const add = (text: string, c: string, size = 22, dy = 0) => floatsRef.current.push({ x, y: y - 20 + dy, text, color: c, life: 1, size });
    if (o === 'hit') { sfx.pop(run.combo); burst(x, y, color, 18, 1); add(`+${step.points}`, '#fff'); }
    else if (o === 'anticipation') { sfx.miss(); add(res.tapped ? 'Too early!' : '', '#cbd5e1', 18); }
    else if (o === 'commission') { sfx.boom(); burst(x, y, '#ffb703', 30, 1.5); burst(x, y, '#ef4444', 14, 1.2); shakeRef.current = 14; flashRef.current = { c: '#f43f5e', a: 0.4 }; add('−100', '#ff8fa3', 28); if (run.practice) add('That was a bomb!', '#fff', 15, 34); }
    else if (o === 'dodge') { sfx.dodge(); add(`Smart! +${step.points}`, '#7ff0d9', 18); }
    else { sfx.miss(); burst(x, y, color, 8, 0.6); add(run.practice ? 'Fruit got away. Tap it!' : 'Missed', '#fcd34d', 16); }
    if (!run.practice) run.results.push(res);
    run.score += step.points; run.combo = step.combo;
    run.i++;
    setHud({ score: run.score, combo: run.combo, i: run.i, n: run.plan.length });
    if (run.i >= run.plan.length) {
      run.finished = true;
      if (run.practice) window.setTimeout(() => setStage('between'), 700);
      else window.setTimeout(() => doneRef.current({ results: run.results }), 800);
    } else { run.st = 'isi'; run.nextAt = now + run.plan[run.i].isiMs; }
  }, [burst]);

  const tap = useCallback((ts: number, px?: number, py?: number) => {
    const run = runRef.current;
    if (px !== undefined && py !== undefined) rippleRef.current.push({ x: px, y: py, t: performance.now() });
    if (!run || run.finished || run.st !== 'fall' || run.tapped) return;
    run.tapped = true;
    const rt = Math.max(0, Math.round(clock(ts) - run.spawnT));
    resolve(run, performance.now(), { tapped: true, rt });
  }, [resolve]);

  // start / restart a run when the stage changes
  useEffect(() => {
    if (stage === 'practice') { runRef.current = makeRun(true); setHud({ score: 0, combo: 0, i: 0, n: FRUIT.practice }); }
    else if (stage === 'real') { runRef.current = makeRun(false); setHud({ score: 0, combo: 0, i: 0, n: FRUIT.trials }); }
  }, [stage, makeRun]);

  // keyboard and pause when the tab is hidden (time spent away must not count against the player)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) tap(e.timeStamp); } };
    const vis = () => {
      const run = runRef.current;
      if (document.hidden) hiddenAt.current = performance.now();
      else if (hiddenAt.current !== null) { const d = performance.now() - hiddenAt.current; hiddenAt.current = null; if (run && !run.finished) { run.nextAt += d; run.spawnT += d; } }
    };
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', vis); };
  }, [tap]);

  // the loop: game clock and drawing
  useEffect(() => {
    const c = cv.current; const g = c?.getContext('2d'); if (!c || !g) return;
    let raf = 0; let last = performance.now();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const stars = Array.from({ length: 46 }, (_, i) => ({ x: ((i * 97) % 100) / 100, y: ((i * 53) % 100) / 100, s: 0.6 + ((i * 31) % 10) / 8, p: i }));
    const frame = (now: number) => {
      const dt = Math.min(2.5, (now - last) / 16.7); last = now;
      const run = runRef.current;
      if (run && !run.finished && !document.hidden) {
        if (run.st === 'isi' && now >= run.nextAt) { run.st = 'fall'; run.spawnT = now; run.tapped = false; }
        else if (run.st === 'fall' && !run.tapped && now - run.spawnT >= FRUIT.fallMs) resolve(run, now, { tapped: false, rt: null });
      }
      const { w, h, dpr } = sizeRef.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // background: dusk gradient, twinkling stars, drifting glows
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#120d3a'); bg.addColorStop(0.55, '#2c1f7a'); bg.addColorStop(1, '#6a2c8f');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (const s of stars) { g.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(now / 900 + s.p)); g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x * w, s.y * h * 0.8, s.s, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
      const glow = g.createRadialGradient(w / 2, h * 1.05, 10, w / 2, h * 1.05, h * 0.7); glow.addColorStop(0, 'rgba(255,122,89,.55)'); glow.addColorStop(1, 'rgba(255,122,89,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      // lane guides
      const laneW = w / FRUIT.lanes;
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.setLineDash([6, 10]);
      for (let i = 1; i < FRUIT.lanes; i++) { g.beginPath(); g.moveTo(i * laneW, 0); g.lineTo(i * laneW, h); g.stroke(); }
      g.setLineDash([]);

      g.save();
      if (shakeRef.current > 0.2 && !reduce) { g.translate((Math.random() - 0.5) * shakeRef.current, (Math.random() - 0.5) * shakeRef.current); shakeRef.current *= Math.pow(0.88, dt); }
      // the falling item
      if (run && !run.finished && run.st === 'fall' && !run.tapped) {
        const trial = run.plan[run.i]; const pos = itemPos(run, now);
        g.save(); g.translate(pos.x, pos.y); g.rotate(Math.sin(now / 280 + run.i) * 0.22);
        const aura = g.createRadialGradient(0, 0, pos.r * 0.4, 0, 0, pos.r * 1.9);
        aura.addColorStop(0, trial.go ? 'rgba(255,255,255,.28)' : 'rgba(244,63,94,.28)'); aura.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = aura; g.beginPath(); g.arc(0, 0, pos.r * 1.9, 0, Math.PI * 2); g.fill();
        if (trial.go) drawFruit(g, trial.kind, pos.r); else drawBomb(g, pos.r, now);
        g.restore();
      }
      // particles
      const fx = fxRef.current;
      for (let i = fx.length - 1; i >= 0; i--) {
        const p = fx[i]; p.life -= (16.7 * dt) / p.max; if (p.life <= 0) { fx.splice(i, 1); continue; }
        if (p.kind === 'ring') { g.strokeStyle = p.color; g.globalAlpha = p.life * 0.8; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, p.size + (1 - p.life) * 70, 0, Math.PI * 2); g.stroke(); continue; }
        p.vy += 0.22 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalAlpha = Math.min(1, p.life * 1.5); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      // floating text
      const fl = floatsRef.current;
      for (let i = fl.length - 1; i >= 0; i--) {
        const f = fl[i]; f.life -= 0.016 * dt; if (f.life <= 0) { fl.splice(i, 1); continue; }
        f.y -= 0.9 * dt; g.globalAlpha = Math.min(1, f.life * 2); g.font = `900 ${f.size}px ui-sans-serif, system-ui, sans-serif`; g.textAlign = 'center';
        g.lineWidth = 5; g.strokeStyle = 'rgba(20,10,60,.7)'; g.strokeText(f.text, Math.max(70, Math.min(w - 70, f.x)), f.y); g.fillStyle = f.color; g.fillText(f.text, Math.max(70, Math.min(w - 70, f.x)), f.y);
      }
      g.globalAlpha = 1;
      // tap ripples
      const rp = rippleRef.current;
      for (let i = rp.length - 1; i >= 0; i--) { const q = rp[i]; const a = (now - q.t) / 380; if (a >= 1) { rp.splice(i, 1); continue; } g.strokeStyle = `rgba(255,255,255,${0.35 * (1 - a)})`; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 8 + a * 34, 0, Math.PI * 2); g.stroke(); }
      g.restore();
      // red flash after a bomb
      if (flashRef.current.a > 0.01) { g.fillStyle = flashRef.current.c; g.globalAlpha = flashRef.current.a; g.fillRect(0, 0, w, h); g.globalAlpha = 1; flashRef.current.a *= Math.pow(0.9, dt); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [resolve]);

  const practice = stage === 'practice';
  return (
    <div className="relative flex flex-col h-full" style={{ background: '#120d3a' }}>
      <Hud label={stage === 'between' ? 'Practice complete' : practice ? `Practice ${Math.min(hud.i + 1, FRUIT.practice)} of ${FRUIT.practice}` : `Item ${Math.min(hud.i + 1, hud.n)} of ${hud.n}`} progress={hud.n ? hud.i / hud.n : 0} score={hud.score} combo={hud.combo} onQuit={onQuit} accent={`linear-gradient(90deg, ${acc.from}, ${acc.to})`}
        extra={practice ? <span className="text-amber-300">Does not count</span> : undefined} />
      <div ref={wrap} className="relative flex-1 min-h-[340px] overflow-hidden touch-none select-none cursor-pointer"
        onPointerDown={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); tap(e.timeStamp, e.clientX - r.left - (r.width - sizeRef.current.w) / 2, e.clientY - r.top); }}>
        <div className="absolute inset-0 flex justify-center"><canvas ref={cv} role="img" aria-label="Fruit Catch playing field. Tap or press Space when fruit falls. Do not tap bombs." /></div>
        {practice && hud.i === 0 && (
          <div className="absolute bottom-6 inset-x-0 text-center pointer-events-none wb-float"><span className="inline-block px-4 py-2 rounded-full bg-white/15 text-white text-xs font-bold backdrop-blur">Tap anywhere or press Space when you see fruit</span></div>
        )}
        {stage === 'between' && <Interstitial emoji="🍎" title="Practice done" text={`Now ${FRUIT.trials} items that count. Fast on fruit, hands off the bombs. A tap that is too early is ignored.`} button="Start the real round" onClick={() => setStage('real')} accent={`linear-gradient(135deg, ${acc.from}, ${acc.to})`} />}
      </div>
    </div>
  );
};
