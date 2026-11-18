import React, { useState } from 'react';
import { Clock, Eye, Flame, Gamepad2, Hand, Lock, Play, ShieldCheck, Sparkles, Target, Trash2, Trophy, Users } from 'lucide-react';
import { GAMES, type GameId } from '../../../shared/wellbeingEngine';
import { wellbeingService, type Me } from '../../services/wellbeingService';
import { Card, ConfirmButton, Notice, btnGhost, useRunner } from '../leave/ui';
import { Loading, useLoad } from '../common/loadUi';
import { ACCENT, GameStyles, SoundToggle, fmt } from './common';
import { GameArt } from './art';
import { unlockAudio } from './sfx';

// ---------------------------------------------------------------- consent

const POINTS = [
  { Icon: Gamepad2, title: 'What this is', text: 'Short games for a break, about 3 to 8 minutes each. You earn points, streaks and personal bests.' },
  { Icon: Target, title: 'What is measured', text: 'While you play, the way you play is recorded: reaction times, accuracy, how long a pattern you can hold, how carefully you check details. These become skill estimates.' },
  { Icon: Eye, title: 'Who sees what', text: 'You see points only. HR sees team averages, and only for groups of 5 or more people. One person\'s picture needs a separate permission, shows only skills that matter for their role, appears only after 5 plays, and every look is logged.' },
  { Icon: Users, title: 'What it is for', text: 'Development and team planning. It is not used for pay, promotion or discipline.' },
  { Icon: Hand, title: 'Your choice', text: 'Playing is optional. If you choose not to record, you can still play and nothing is saved. You can change this at any time and delete your game data from My progress.' },
];

export const Consent: React.FC<{ me: Me; onDone: () => void; onCancel?: () => void }> = ({ me, onDone, onCancel }) => {
  const { run, busy, note } = useRunner();
  const choose = (optIn: boolean) => run(async () => { await wellbeingService.consent(optIn); onDone(); });
  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-3xl overflow-hidden border border-slate-200 bg-white shadow-xl wb-rise">
        <div className="px-6 pt-7 pb-6 text-white" style={{ background: 'linear-gradient(135deg, #7c5cff, #38d5c9)' }}>
          <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center mb-3"><ShieldCheck className="w-6 h-6" /></div>
          <h2 className="text-2xl font-black tracking-tight">Before you play</h2>
          <p className="text-sm font-medium text-white/90 mt-1">Here is exactly what happens with your games, in plain words.</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {POINTS.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3.5 px-6 py-4">
              <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px]" /></div>
              <div><div className="text-sm font-extrabold text-slate-900">{title}</div><p className="text-[13px] text-slate-600 leading-relaxed mt-0.5">{text}</p></div>
            </li>
          ))}
        </ul>
        <div className="p-6 space-y-2.5 bg-slate-50">
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <button type="button" disabled={busy} onClick={() => { unlockAudio(); void choose(true); }} className="w-full py-3.5 rounded-2xl text-white font-extrabold text-sm shadow-lg active:scale-[.98] transition-transform disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #7c5cff, #5b3ad6)' }}>Yes, record my results</button>
          <button type="button" disabled={busy} onClick={() => void choose(false)} className="w-full py-3.5 rounded-2xl bg-white border border-slate-300 text-slate-800 font-extrabold text-sm hover:bg-slate-100 disabled:opacity-60">Play without recording</button>
          {me.consent.answered && onCancel && <button type="button" onClick={onCancel} className="w-full text-xs font-bold text-slate-500 hover:text-slate-800 py-1.5">Keep things as they are</button>}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- play hub

const when = (iso: string) => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

export const PlayHub: React.FC<{ me: Me; onPick: (g: GameId) => void; onChangeConsent: () => void }> = ({ me, onPick, onChangeConsent }) => {
  const ring = me.today.cap ? Math.min(1, me.today.plays / me.today.cap) : 0;
  const C = 2 * Math.PI * 22;
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <GameStyles />
      <div className="relative overflow-hidden rounded-3xl text-white p-6 sm:p-7 shadow-lg" style={{ background: 'linear-gradient(120deg, #4b30c9 0%, #7c5cff 45%, #38d5c9 100%)' }}>
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-xl" aria-hidden />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80 inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Wellbeing break</div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mt-1">Take five. Play something.</h2>
            <p className="text-sm text-white/90 mt-1 max-w-sm">A quick game clears your head. Points and streaks are just for you.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-center"><div className="inline-flex items-center gap-1 text-2xl font-black"><Flame className="w-6 h-6 text-amber-300" />{me.streak}</div><div className="text-[10px] font-bold uppercase tracking-wider text-white/75">Day streak</div></div>
            <div className="relative w-14 h-14" title={`${me.today.left} plays left today`}>
              <svg viewBox="0 0 52 52" className="w-14 h-14 -rotate-90"><circle cx="26" cy="26" r="22" stroke="rgba(255,255,255,.25)" strokeWidth="5" fill="none" /><circle cx="26" cy="26" r="22" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ring)} style={{ transition: 'stroke-dashoffset .6s' }} /></svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center leading-none"><span className="text-base font-black">{me.today.left}</span><span className="text-[8px] font-bold uppercase text-white/80">left</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {me.games.map((g, idx) => {
          const a = ACCENT[g.id]; const out = me.today.left < 1;
          return (
            <button key={g.id} type="button" onClick={() => { unlockAudio(); onPick(g.id); }} disabled={out}
              className="group text-left rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-violet-300">
              <div className="relative px-4 pt-4 pb-1" style={{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }}>
                {idx === 0 && me.games.length > 1 && <span className="absolute top-3 left-3 text-[10px] font-extrabold uppercase tracking-wider bg-white/90 rounded-full px-2 py-0.5" style={{ color: a.text }}>Suggested today</span>}
                <GameArt game={g.id} className="w-full h-28 group-hover:scale-105 transition-transform" />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2"><h3 className="text-base font-black text-slate-900">{g.name}</h3><span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 shrink-0"><Clock className="w-3 h-3" />{g.minutes} min</span></div>
                <p className="text-xs text-slate-500 mt-0.5">{g.tagline}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] font-bold text-slate-500 inline-flex items-center gap-1">{g.best > 0 ? <><Trophy className="w-3.5 h-3.5 text-amber-500" />Best {fmt(g.best)}</> : 'New for you'}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-extrabold px-3 py-1.5 rounded-full text-white" style={{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }}><Play className="w-3 h-3 fill-white" />Play</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {me.today.left < 1 && <Notice tone="info">That is all your plays for today. Come back tomorrow, your streak is safe.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
        <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />{me.consent.optedIn ? 'Your results are recorded for development and team planning.' : 'Recording is off. Nothing you play is saved.'}</span>
        <span className="flex items-center gap-2"><button type="button" onClick={onChangeConsent} className="font-bold text-violet-700 hover:underline">Change this</button><SoundToggle /></span>
      </div>
      {me.recent.length > 0 && (
        <Card title="Recent plays">
          <ul className="divide-y divide-slate-100">
            {me.recent.slice(0, 4).map((r, i) => <li key={i} className="flex items-center justify-between py-2 text-sm"><span className="font-semibold text-slate-700">{GAMES[r.game]?.name}</span><span className="text-slate-500 text-xs">{when(r.at)} <b className="text-slate-800 ml-2">{fmt(r.points)}</b></span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- my progress

export const Progress: React.FC<{ onChangeConsent: () => void; onChanged: () => void }> = ({ onChangeConsent, onChanged }) => {
  const { data, error, loading, reload } = useLoad(() => wellbeingService.progress(), []);
  const { run, busy, note } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const max = Math.max(1, ...data.calendar.map((c: any) => c.plays));
  const firstDow = (new Date(`${data.calendar[0].day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const cells: ({ day: string; plays: number } | null)[] = [...Array(firstDow).fill(null), ...data.calendar];
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Day streak', value: data.streak, Icon: Flame, c: 'text-amber-500' }, { label: 'Best streak', value: data.bestStreak, Icon: Trophy, c: 'text-violet-500' }, { label: 'Games played', value: data.plays, Icon: Gamepad2, c: 'text-teal-500' }].map(({ label, value, Icon, c }) => (
          <div key={label} className="rounded-2xl bg-white border border-slate-200 p-4 text-center shadow-sm"><Icon className={`w-6 h-6 mx-auto ${c}`} /><div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{value}</div><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div></div>
        ))}
      </div>
      <Card title="Personal bests">
        <div className="grid sm:grid-cols-3 gap-3">
          {data.games.map((g: any) => { const a = ACCENT[g.id as GameId]; const v = data.bests?.[g.id] || 0; return (
            <div key={g.id} className="rounded-2xl p-3.5" style={{ background: a.soft }}><div className="text-xs font-extrabold" style={{ color: a.text }}>{g.name}</div><div className="text-2xl font-black text-slate-900 tabular-nums mt-0.5">{v ? fmt(v) : '–'}</div><div className="text-[11px] text-slate-500">{v ? 'points' : 'not played yet'}</div></div>
          ); })}
        </div>
      </Card>
      <Card title="Last 4 weeks" subtitle="Each square is a day. Darker means more plays.">
        <div className="grid grid-cols-7 gap-1.5 max-w-xs">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="text-[10px] font-bold text-slate-400 text-center">{d}</div>)}
          {cells.map((c, i) => c ? (
            <div key={i} title={`${c.day}: ${c.plays} play${c.plays === 1 ? '' : 's'}`} className="aspect-square rounded-md" style={{ background: c.plays ? `rgba(124,92,255,${0.25 + 0.75 * (c.plays / max)})` : '#eef0f6' }} />
          ) : <div key={i} />)}
        </div>
      </Card>
      <Card title="History">
        {data.history.length === 0 ? <p className="text-sm text-slate-500 py-3">Nothing here yet. Play a game and it will show up.</p> : (
          <ul className="divide-y divide-slate-100">
            {data.history.map((h: any) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><div className="text-sm font-bold text-slate-800">{GAMES[h.game as GameId]?.name}</div><div className="text-[11px] text-slate-400 truncate">{when(h.at)}{h.highlight ? ` · ${h.highlight}` : ''}</div></div><div className="text-base font-black text-slate-900 tabular-nums">{fmt(h.points)}</div></li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Your data" subtitle="You are in control of what is kept.">
        {note && <div className="mb-3"><Notice tone={note.tone}>{note.text}</Notice></div>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnGhost} onClick={onChangeConsent}>Change recording choice</button>
          <ConfirmButton disabled={busy || data.plays === 0} question="Delete all your game data?" yes="Delete" onConfirm={() => run(async () => { await wellbeingService.forgetMe(); await reload(); onChanged(); }, 'Your game data was deleted.')}><Trash2 className="w-3.5 h-3.5" />Delete my game data</ConfirmButton>
        </div>
      </Card>
    </div>
  );
};
