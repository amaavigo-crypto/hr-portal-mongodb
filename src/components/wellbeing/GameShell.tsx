import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Flame, Play, RotateCcw, ShieldCheck, ShieldOff, Trophy } from 'lucide-react';
import { GAMES, scoreSession, type GameId } from '../../../shared/wellbeingEngine';
import { wellbeingService, type FinishResult, type Me, type MeGame } from '../../services/wellbeingService';
import { ACCENT, Confetti, Countdown, GameStyles, SoundToggle, fmt, useCountUp, type GameProps } from './common';
import { GameArt } from './art';
import { sfx, unlockAudio } from './sfx';
import { FruitCatch } from './games/FruitCatch';
import { EchoBeats } from './games/EchoBeats';
import { FraudHunter } from './games/FraudHunter';

const COMPONENT: Record<GameId, React.FC<GameProps>> = { 'fruit-catch': FruitCatch, 'echo-beats': EchoBeats, 'fraud-hunter': FraudHunter };
const HOW: Record<GameId, string[]> = {
  'fruit-catch': ['Fruit falls down one of five lanes, one at a time.', 'Tap anywhere (or press Space) the moment you see fruit.', 'Bombs: do nothing. Tapping a bomb costs you points.'],
  'echo-beats': ['Watch the pads light up and listen to the tune.', 'Play it back by tapping the pads in the same order.', 'Every round adds a note. Three mistakes end the game.'],
  'fraud-hunter': ['Each invoice has at most one line that does not add up.', 'Tap the wrong line, or press All clear if everything is right.', 'Be quick but careful: every invoice has a 25 second timer.'],
};

type Phase = 'intro' | 'starting' | 'countdown' | 'play' | 'saving' | 'result';
interface Outcome { points: number; highlight: string; recorded: boolean; saved: boolean; previousBest: number; newBest: boolean; left: number; streak: number }

/** One play from start to finish: how to play, 3-2-1, the game, saving, and the result screen. */
export const GameShell: React.FC<{ game: MeGame; me: Me; onExit: () => void; onChanged: () => void }> = ({ game, me, onExit, onChanged }) => {
  const acc = ACCENT[game.id];
  const def = GAMES[game.id];
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [run, setRun] = useState<{ sessionId: string | null; seed: string; recorded: boolean; left: number } | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const Game = COMPONENT[game.id];
  const grad = `linear-gradient(135deg, ${acc.from}, ${acc.to})`;

  const begin = async () => {
    unlockAudio(); setError(''); setPhase('starting');
    try {
      const r = await wellbeingService.start(game.id);
      setRun({ sessionId: r.sessionId, seed: r.seed, recorded: r.recorded, left: r.today.left });
      setPhase('countdown');
    } catch (e: any) { setError(e?.message || 'Could not start the game.'); setPhase('intro'); }
  };

  const finished = useCallback(async (payload: any) => {
    if (!run) return;
    setPhase('saving');
    const local = scoreSession(game.id, run.seed, payload);
    let result: Outcome | null = null;
    if (run.recorded && run.sessionId) {
      try {
        const r: FinishResult = await wellbeingService.finish(run.sessionId, payload);
        result = { points: r.points, highlight: r.highlight, recorded: true, saved: true, previousBest: r.previousBest, newBest: r.newBest, left: r.today.left, streak: r.streak };
      } catch { /* fall back to the local result below, marked as not saved */ }
    }
    if (!result) {
      if (!local.ok) { setError('Something went wrong with that round, so it was not counted. Please try again.'); setPhase('intro'); return; }
      result = { points: local.points, highlight: local.highlight, recorded: run.recorded, saved: false, previousBest: game.best, newBest: false, left: run.left, streak: me.streak };
    }
    setOut(result); setPhase('result'); onChanged();
    window.setTimeout(() => (result!.newBest ? sfx.best() : sfx.win()), 250);
  }, [run, game, me.streak, onChanged]);

  const shown = useCountUp(out?.points || 0, 1100);
  useEffect(() => { if (phase === 'play') document.body.style.overscrollBehavior = 'contain'; return () => { document.body.style.overscrollBehavior = ''; }; }, [phase]);

  return (
    <div className="max-w-[520px] mx-auto w-full">
      <GameStyles />
      {phase === 'intro' || phase === 'starting' ? (
        <div className="rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-xl wb-rise">
          <div className="relative px-6 pt-5 pb-2 text-white" style={{ background: grad }}>
            <div className="flex items-center justify-between">
              <button type="button" onClick={onExit} className="inline-flex items-center gap-1 text-xs font-bold bg-white/20 hover:bg-white/30 rounded-full pl-2 pr-3 py-1.5"><ArrowLeft className="w-3.5 h-3.5" />Games</button>
              <SoundToggle dark />
            </div>
            <GameArt game={game.id} className="w-full max-w-[260px] h-36 mx-auto" />
            <h2 className="text-3xl font-black tracking-tight text-center">{game.name}</h2>
            <p className="text-center text-sm font-semibold text-white/90 pb-4">{game.tagline}</p>
          </div>
          <div className="p-6">
            <ol className="space-y-3">
              {HOW[game.id].map((t, i) => (
                <li key={i} className="flex gap-3 items-start"><span className="w-6 h-6 rounded-full text-xs font-black text-white flex items-center justify-center shrink-0 mt-0.5" style={{ background: grad }}>{i + 1}</span><span className="text-sm text-slate-700 leading-relaxed">{t}</span></li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 mt-5 text-[11px] font-bold">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">About {def.minutes} min</span>
              {game.id !== 'echo-beats' && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">Short practice first</span>}
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${me.consent.optedIn ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{me.consent.optedIn ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}{me.consent.optedIn ? 'Results recorded' : 'Not recorded'}</span>
            </div>
            {error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
            <button type="button" disabled={phase === 'starting' || me.today.left < 1} onClick={begin} className="mt-5 w-full py-3.5 rounded-2xl text-white font-extrabold text-base shadow-lg disabled:opacity-60 active:scale-[.98] transition-transform inline-flex items-center justify-center gap-2" style={{ background: grad, boxShadow: `0 10px 30px ${acc.glow}` }}>
              <Play className="w-5 h-5 fill-white" />{phase === 'starting' ? 'Getting ready…' : me.today.left < 1 ? 'No plays left today' : 'Play'}
            </button>
            <p className="text-center text-[11px] text-slate-400 mt-2.5">{me.today.left} of {me.today.cap} plays left today</p>
          </div>
        </div>
      ) : phase === 'result' && out ? (
        <div className="relative rounded-3xl overflow-hidden text-white shadow-2xl wb-rise" style={{ background: grad }}>
          <Confetti run={out.newBest} />
          <div className="relative px-6 pt-8 pb-6 text-center">
            <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-white/80">{game.name}</div>
            {out.newBest && <div className="wb-pop inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-white text-xs font-black" style={{ color: acc.text }}><Trophy className="w-3.5 h-3.5" />New personal best!</div>}
            <div className="mt-3 text-7xl font-black tabular-nums tracking-tight drop-shadow">{fmt(shown)}</div>
            <div className="text-sm font-bold text-white/85">points</div>
            {out.highlight && <p className="mt-4 text-sm font-semibold bg-white/20 rounded-2xl px-4 py-2.5 inline-block">{out.highlight}</p>}
            <div className="grid grid-cols-3 gap-2 mt-5 text-center">
              <div className="rounded-2xl bg-black/15 py-2.5"><div className="text-lg font-black">{out.recorded && out.saved ? fmt(out.newBest ? out.points : Math.max(out.previousBest, out.points)) : '–'}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/75">Best</div></div>
              <div className="rounded-2xl bg-black/15 py-2.5"><div className="text-lg font-black inline-flex items-center gap-1 justify-center"><Flame className="w-4 h-4" />{out.recorded ? out.streak : '–'}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/75">Day streak</div></div>
              <div className="rounded-2xl bg-black/15 py-2.5"><div className="text-lg font-black">{out.left}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/75">Plays left</div></div>
            </div>
            {!out.recorded && <p className="mt-4 text-xs font-semibold text-white/85">Recording is off, so this round was not saved.</p>}
            {out.recorded && !out.saved && <p className="mt-4 text-xs font-semibold bg-black/20 rounded-xl px-3 py-2">We could not save this round. Check your connection and play again.</p>}
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={onExit} className="flex-1 py-3 rounded-2xl bg-white/20 hover:bg-white/30 font-extrabold text-sm">All games</button>
              {out.left > 0 && <button type="button" onClick={() => { setOut(null); setRun(null); setPhase('intro'); }} className="flex-1 py-3 rounded-2xl bg-white font-extrabold text-sm inline-flex items-center justify-center gap-1.5" style={{ color: acc.text }}><RotateCcw className="w-4 h-4" />Play again</button>}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-black/10 h-[calc(100dvh-9rem)] min-h-[560px] max-h-[820px]" style={{ background: '#120d3a' }}>
          {(phase === 'play' || phase === 'saving') && run && <Game seed={run.seed} onDone={finished} onQuit={() => { setRun(null); setPhase('intro'); onChanged(); }} />}
          {phase === 'countdown' && (<><div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${acc.glow}, #0d0a2b 70%)` }} /><Countdown accent={acc.glow} onDone={() => setPhase('play')} /></>)}
          {phase === 'saving' && <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 text-white font-extrabold backdrop-blur-sm"><div className="wb-pop">Counting your points…</div></div>}
        </div>
      )}
    </div>
  );
};
