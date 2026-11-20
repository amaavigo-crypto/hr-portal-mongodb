import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { pmService } from '../services/pmService';
import { Card, Field, Notice, ToastProvider, btnGhost, btnPrimary, input, useRunner } from './leave/ui';
import { RatingPick } from './pm/common';
import { DEFAULT_PM2, type Pm2Config } from '../../shared/pm2Engine';

/**
 * Performance 2: calibration, increments, goals as evidence and 360 feedback, built on the Performance reviews.
 * Server side: api/_lib/pm2Api.ts (actions p2-*). Everyone sees "Feedback"; managers also see "Increments" and "Goals";
 * HR and approvers also see "Calibration"; HR also sees "Settings".
 */
type Tab = 'feedback' | 'goals' | 'increments' | 'calibration' | 'settings';
const p2 = { get: <T = any,>(a: string, q: Record<string, string | undefined> = {}) => pmService.get<T>(`p2-${a}`, q), post: <T = any,>(a: string, b: unknown = {}) => pmService.post<T>(`p2-${a}`, b) };

const quarterNow = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const prevQuarter = (k: string) => { const y = Number(k.slice(0, 4)); const q = Number(k.slice(6)); return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`; };

const QuarterPick: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const now = quarterNow();
  const opts = [now, prevQuarter(now), prevQuarter(prevQuarter(now)), prevQuarter(prevQuarter(prevQuarter(now)))];
  return <select aria-label="Quarter" className={`${input} !w-auto`} value={value} onChange={(e) => onChange(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>;
};

const Bars: React.FC<{ title: string; rows: { band: string; count: number; pct: number }[] }> = ({ title, rows }) => (
  <div className="flex-1 min-w-[220px]">
    <p className="text-xs font-bold text-slate-600 mb-1.5">{title}</p>
    {rows.map((r) => (
      <div key={r.band} className="flex items-center gap-2 text-xs mb-1">
        <span className="w-36 truncate text-slate-700">{r.band}</span>
        <div className="flex-1 h-2.5 bg-slate-100 rounded"><div className="h-2.5 rounded bg-[#6d4cf0]" style={{ width: `${r.pct}%` }} /></div>
        <span className="w-14 text-right tabular-nums text-slate-600">{r.count} · {r.pct}%</span>
      </div>
    ))}
  </div>
);

// ------------------------------------------------------------------ calibration

const Calibration: React.FC = () => {
  const [cycle, setCycle] = useState(prevQuarter(quarterNow()));
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<{ uid: string; to: string; reason: string } | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => p2.get('cal', { cycle }).then(setD).catch(() => setD(null)), [cycle]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const final = d.status === 'FINAL';
  return (
    <div className="space-y-4">
      <Card title="Calibration" subtitle="Compare scores across the group before they become final. Every change needs a reason and the original score is always kept."
        right={<QuarterPick value={cycle} onChange={setCycle} />}>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        {!d.opened ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">Calibration is not open for {cycle}. Opening it freezes today's bands and increment rules for this quarter, so later edits only affect the next one.</p>
            <button className={btnPrimary} disabled={busy || !d.rows.length} onClick={() => run(async () => { await p2.post('cal-open', { cycle }); await load(); }, 'Calibration opened.')}>Open calibration for {cycle}</button>
            {!d.rows.length && <p className="text-xs text-slate-500">No review has a score yet.</p>}
          </div>
        ) : (
          <p className="text-xs text-slate-600">Settings version {d.version} is frozen for this quarter{d.amended ? ` (amended ${d.amended}×)` : ''}. {final ? 'Calibration is final: scores are locked.' : 'Open: scores can still change.'}</p>
        )}
      </Card>
      {d.opened && (
        <>
          <Card title="Spread of scores"><div className="flex flex-wrap gap-6"><Bars title="Before" rows={d.before} /><Bars title="After calibration" rows={d.after} /></div>
            <p className="text-xs text-slate-500 mt-2">The spread is shown to help you compare. It is never forced: nobody is moved just to fit a shape.</p></Card>
          <Card title="People">
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Name</th><th>Team</th><th>Manager's score</th><th>Calibrated</th><th>Band</th><th /></tr></thead><tbody>
              {d.rows.map((r: any) => (
                <React.Fragment key={r.uid}>
                  <tr className="border-t border-slate-100"><td className="py-1.5 font-medium">{r.name}</td><td className="text-slate-600">{r.group}</td><td>{r.original.toFixed(2)}</td>
                    <td className={r.changes ? 'font-bold text-[#6d4cf0]' : ''}>{r.calibrated.toFixed(2)}</td><td>{r.band}{r.band !== r.originalBand && <span className="text-xs text-slate-500"> (was {r.originalBand})</span>}</td>
                    <td className="text-right">{!final && <button className={btnGhost} onClick={() => setEdit({ uid: r.uid, to: String(r.calibrated), reason: '' })}>Adjust</button>}</td></tr>
                  {r.lastReason && <tr><td colSpan={6} className="pb-1.5 text-xs text-slate-500">Reason: {r.lastReason}</td></tr>}
                  {edit?.uid === r.uid && (
                    <tr><td colSpan={6} className="pb-3"><div className="bg-slate-50 rounded-lg p-3 grid gap-2 md:grid-cols-[120px_1fr_auto]">
                      <Field label="New score (1-5)"><input className={input} type="number" min={1} max={5} step={0.01} value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} /></Field>
                      <Field label="Reason (kept on the record)"><input className={input} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field>
                      <div className="flex items-end gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('cal-adjust', { cycle, uid: r.uid, to: edit.to, reason: edit.reason }); setEdit(null); await load(); }, 'Score adjusted.')}>Save</button><button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button></div>
                    </div></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody></table></div>
          </Card>
          {!final && (
            <Card title="Finish">
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} disabled={busy} onClick={() => { if (window.confirm('Lock these scores? Increments can be recommended after this, and scores can no longer change.')) run(async () => { await p2.post('cal-finalise', { cycle }); await load(); }, 'Calibration is final.'); }}>Make final</button>
                <button className={btnGhost} disabled={busy} onClick={() => { const reason = window.prompt('Why are the rules being changed in the middle of this quarter?') || ''; if (reason) run(async () => { await p2.post('cal-amend', { cycle, reason }); await load(); }, 'This quarter now uses the latest settings.'); }}>Use the latest settings for this quarter…</button>
              </div>
            </Card>
          )}
          {d.changes.length > 0 && (
            <Card title="Change log"><ul className="text-sm space-y-1.5">{d.changes.map((c: any, i: number) => <li key={i} className="text-slate-700"><b>{d.rows.find((r: any) => r.uid === c.uid)?.name || c.uid}</b>: {c.from} → {c.to} by {c.by}. <span className="text-slate-500">{c.reason}</span></li>)}</ul></Card>
          )}
        </>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ increments

const STATUS: Record<string, string> = { RECOMMENDED: 'Waiting for HR', HR_APPROVED: 'Waiting for second approver', APPROVED: 'Approved, not sent to Payroll', REJECTED: 'Rejected', SENT: 'Sent to Payroll' };

const Increments: React.FC<{ hr: boolean; approver: boolean }> = ({ hr, approver }) => {
  const [cycle, setCycle] = useState(prevQuarter(quarterNow()));
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<{ uid: string; pct: string; reason: string } | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => p2.get('inc', { cycle }).then(setD).catch(() => setD(null)), [cycle]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <Card title="Increments" subtitle="Recommend within the range for each band. Approved increments go to Payroll as a proposal; Payroll applies them." right={<QuarterPick value={cycle} onChange={setCycle} />}>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {d.message && <Notice>{d.message}</Notice>}
      {!d.ready && !d.message && <Notice tone="warn">Calibration is not final for {cycle} yet. Recommendations open once it is.</Notice>}
      {d.rows.length === 0 && d.ready && <p className="text-sm text-slate-500">Nobody to show for this quarter.</p>}
      <div className="space-y-2">
        {d.rows.map((r: any) => (
          <div key={r.uid} className="border border-slate-200 rounded-xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-semibold text-slate-900">{r.name}</p><p className="text-xs text-slate-600">{r.band} · score {r.score.toFixed(2)} · allowed {r.minPct}% to {r.maxPct}%</p></div>
              <div className="text-right text-xs">{r.proposal ? <><p className="font-bold text-slate-800">{r.proposal.pct}% · {STATUS[r.proposal.status]}</p><p className="text-slate-500">{r.proposal.reason}</p></> : <span className="text-slate-500">No recommendation yet</span>}</div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {d.ready && (!r.proposal || ['RECOMMENDED', 'REJECTED'].includes(r.proposal.status)) && <button className={btnGhost} onClick={() => setForm({ uid: r.uid, pct: String(r.proposal?.pct ?? r.minPct), reason: '' })}>{r.proposal ? 'Change recommendation' : 'Recommend'}</button>}
              {r.proposal && ['RECOMMENDED', 'HR_APPROVED'].includes(r.proposal.status) && (hr || approver) && (<>
                <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('inc-decide', { id: r.proposal.id, decision: 'approve' }); await load(); }, 'Approved.')}>Approve</button>
                <button className={btnGhost} disabled={busy} onClick={() => { const note2 = window.prompt('Why is it being rejected?') || ''; if (note2) run(async () => { await p2.post('inc-decide', { id: r.proposal.id, decision: 'reject', note: note2 }); await load(); }, 'Rejected.'); }}>Reject</button>
              </>)}
              {r.proposal?.status === 'APPROVED' && hr && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('inc-send', { id: r.proposal.id }); await load(); }, 'Sent to Payroll as a scheduled change.')}>Send to Payroll</button>}
            </div>
            {form?.uid === r.uid && (
              <div className="bg-slate-50 rounded-lg p-3 mt-2 grid gap-2 md:grid-cols-[120px_1fr_auto]">
                <Field label="Increment %"><input className={input} type="number" min={r.minPct} max={r.maxPct} step={0.5} value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} /></Field>
                <Field label="Why this amount"><input className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
                <div className="flex items-end gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('inc-recommend', { cycle, uid: r.uid, pct: form.pct, reason: form.reason }); setForm(null); await load(); }, 'Recommendation saved.')}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------ goals as evidence

const Goals: React.FC<{ me: string; people: { uid: string; name: string }[] }> = ({ me, people }) => {
  const [cycle, setCycle] = useState(quarterNow());
  const [uid, setUid] = useState(me);
  const [d, setD] = useState<any>(null);
  const [rating, setRating] = useState<number | 'NO' | null>(null);
  const [why, setWhy] = useState('');
  const [err, setErr] = useState('');
  const { busy, note, run } = useRunner();
  const load = useCallback(() => { setErr(''); p2.get('goals', { cycle, uid }).then((x) => { setD(x); setRating(x.confirmed?.rating ?? x.suggested ?? null); }).catch((e) => { setD(null); setErr(e?.message || 'Not available.'); }); }, [cycle, uid]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title="Goals as evidence" subtitle="Progress on a person's objectives suggests a rating. It stays a suggestion until a reviewer confirms it." right={<QuarterPick value={cycle} onChange={setCycle} />}>
      {people.length > 0 && <Field label="Person"><select className={input} value={uid} onChange={(e) => setUid(e.target.value)}><option value={me}>Me</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>}
      {err && <Notice tone="warn">{err}</Notice>}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {d && (
        <div className="space-y-3 mt-2">
          {d.objectives.length === 0 ? <p className="text-sm text-slate-500">No individual objectives for {cycle}.</p> : d.objectives.map((o: any) => (
            <div key={o.id}><div className="flex justify-between text-sm"><span>{o.title}</span><span className="tabular-nums">{o.progress}%</span></div><div className="h-2 bg-slate-100 rounded"><div className="h-2 rounded bg-[#6d4cf0]" style={{ width: `${o.progress}%` }} /></div></div>
          ))}
          {d.averageProgress !== null && <p className="text-sm text-slate-800"><b>Suggested rating: {d.suggested}</b> (average progress {d.averageProgress}%)</p>}
          {d.confirmed && <p className="text-sm text-emerald-700">Confirmed as {d.confirmed.rating === 'NO' ? 'Not observed' : d.confirmed.rating} by {d.confirmed.by}.{d.confirmed.note ? ` ${d.confirmed.note}` : ''}</p>}
          {uid !== me && d.averageProgress !== null && (
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-slate-600">Your confirmed rating</p>
              <RatingPick value={rating} onChange={setRating} />
              <Field label="Reason (needed if it differs from the suggestion)"><input className={input} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
              <button className={btnPrimary} disabled={busy || rating === null} onClick={() => run(async () => { await p2.post('goals-confirm', { cycle, uid, rating, note: why }); await load(); }, 'Confirmed.')}>Confirm rating</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ 360 feedback

const Give: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState('');
  const [ratings, setRatings] = useState<Record<string, number | 'NO' | null>>({});
  const [comment, setComment] = useState('');
  const { busy, note, run } = useRunner();
  const load = useCallback(() => p2.get('360-todo').then(setD).catch(() => setD({ items: [], competencies: [] })), []);
  useEffect(() => { load(); }, [load]);
  if (!d || d.items.length === 0) return null;
  return (
    <Card title="Feedback you were asked to give" subtitle="Your name is never shown to the person or their manager. You can send it once.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {d.items.map((it: any) => (
        <div key={it.id} className="border border-slate-200 rounded-xl p-3 mb-2">
          <div className="flex items-center justify-between"><p className="font-semibold">{it.subjectName} <span className="text-xs text-slate-500">· {it.cycleKey}</span></p><button className={btnGhost} onClick={() => { setOpen(open === it.id ? '' : it.id); setRatings({}); setComment(''); }}>{open === it.id ? 'Close' : 'Give feedback'}</button></div>
          {open === it.id && (
            <div className="mt-3 space-y-3">
              {d.competencies.map((c: any) => <div key={c.id}><p className="text-sm font-medium">{c.name}</p><p className="text-xs text-slate-500 mb-1">{c.standard}</p><RatingPick label={c.name} value={ratings[c.id] ?? null} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} /></div>)}
              <Field label="Anything to add? (optional, shown without your name)"><textarea className={input} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const clean: Record<string, any> = {}; Object.entries(ratings).forEach(([k, v]) => { if (v !== null) clean[k] = v; }); await p2.post('360-give', { id: it.id, ratings: clean, comment }); setOpen(''); await load(); onDone(); }, 'Sent. Thank you.')}>Send feedback</button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
};

const Summary: React.FC<{ r: any }> = ({ r }) => !r ? null : !r.available ? <p className="text-sm text-slate-500">{r.message}</p> : (
  <div className="space-y-2">
    {!r.enough ? <Notice tone="info">{r.waiting}</Notice> : (<>
      <p className="text-sm text-slate-800"><b>Average: {r.average ?? '-'}</b> from {r.responded} of {r.requested} people</p>
      <ul className="text-sm space-y-0.5">{r.byCompetency.map((x: any) => <li key={x.id} className="flex justify-between"><span>{x.name}</span><span className="tabular-nums">{x.average ?? 'Too few answers to show'}</span></li>)}</ul>
      {r.comments.length > 0 && <div><p className="text-xs font-bold text-slate-600 mt-2">Comments (no names)</p><ul className="list-disc ml-5 text-sm text-slate-700">{r.comments.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>}
      {r.blend && <p className="text-xs text-slate-600 border-t border-slate-100 pt-2">Behaviour score: manager {r.blend.managerBehaviour ?? '-'}; peers {r.blend.peerAverage ?? '-'}; suggested {r.blend.suggested ?? '-'} (peers can shape {r.blend.peerSharePct}%). {r.blend.note}</p>}
    </>)}
  </div>
);

const Feedback: React.FC<{ me: string; hr: boolean; refresh: () => void; people: { uid: string; name: string }[] }> = ({ me, hr, refresh, people }) => {
  const [cycle, setCycle] = useState(quarterNow());
  const [p, setP] = useState<any>(null);
  const [mine, setMine] = useState<any>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState(me);
  const [view, setView] = useState<{ uid: string; r: any } | null>(null);
  const [identities, setIdentities] = useState<any>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => {
    p2.get('360-panels', { cycle }).then(setP).catch(() => setP(null));
    p2.get('360-result', { cycle }).then(setMine).catch(() => setMine(null));
  }, [cycle]);
  useEffect(() => { load(); }, [load]);
  const everyone = people;
  return (
    <div className="space-y-4">
      <Give onDone={() => { load(); refresh(); }} />
      <Card title="360 feedback" subtitle="Ask a few colleagues for confidential feedback. Results appear only once enough people have answered, and no one is named." right={<QuarterPick value={cycle} onChange={setCycle} />}>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <p className="text-xs font-bold text-slate-600 mb-1">Your own summary</p>
        <Summary r={mine} />
      </Card>
      <Card title="Choose reviewers">
        <div className="grid gap-2 md:grid-cols-2">
          {(hr || people.length > 0) && <Field label="For"><select className={input} value={subject} onChange={(e) => setSubject(e.target.value)}><option value={me}>Me</option>{people.map((x) => <option key={x.uid} value={x.uid}>{x.name}</option>)}</select></Field>}
          <Field label="Reviewers (pick at least 3)" hint="Hold Ctrl/Cmd to pick several."><select multiple className={`${input} h-32`} value={picked} onChange={(e) => setPicked(Array.from(e.target.selectedOptions).map((o) => o.value))}>{everyone.filter((x) => x.uid !== subject).map((x) => <option key={x.uid} value={x.uid}>{x.name}</option>)}{subject !== me && <option value={me}>Me</option>}</select></Field>
        </div>
        <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('360-nominate', { cycle, uid: subject, raters: picked }); setPicked([]); load(); }, hr ? 'Reviewers approved and asked.' : 'Sent to HR for approval.')}>Submit reviewers</button>
      </Card>
      {p?.rows?.length > 0 && (
        <Card title={hr ? 'All panels' : 'Panels you can see'}>
          {p.rows.map((x: any) => (
            <div key={x.id} className="border-t border-slate-100 py-2 first:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-medium">{x.name}</p><p className="text-xs text-slate-500">{x.status === 'APPROVED' ? 'Approved' : 'Waiting for HR'} · {x.responded} of {x.requested} answered{x.released ? ' · released to employee' : ''}{x.nominated ? ` · chosen: ${x.nominated.join(', ')}` : ''}</p></div>
                <div className="flex gap-2">
                  {x.uid !== me && <button className={btnGhost} onClick={async () => setView({ uid: x.uid, r: await p2.get('360-result', { cycle, uid: x.uid }) })}>Summary</button>}
                  {hr && x.status === 'PROPOSED' && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await p2.post('360-approve', { id: x.id }); load(); }, 'Approved. Reviewers have been asked.')}>Approve</button>}
                  {hr && x.status === 'APPROVED' && !x.released && x.uid !== me && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await p2.post('360-release', { id: x.id }); load(); }, 'Released to the employee.')}>Release to employee</button>}
                  {hr && x.uid !== me && x.status === 'APPROVED' && <button className={btnGhost} onClick={async () => { const reason = window.prompt('Why do you need to see who said what? This is logged.') || ''; if (reason) { try { setIdentities(await p2.post('360-audit', { id: x.id, reason })); } catch (e: any) { window.alert(e?.message || 'Not allowed'); } } }}>Audit…</button>}
                </div>
              </div>
              {view?.uid === x.uid && <div className="bg-slate-50 rounded-lg p-3 mt-2"><Summary r={view.r} /></div>}
            </div>
          ))}
        </Card>
      )}
      {identities && <Card title={`Audit: ${identities.name}`} right={<button className={btnGhost} onClick={() => setIdentities(null)}>Hide</button>}><ul className="text-sm space-y-1">{identities.raters.map((r: any, i: number) => <li key={i}><b>{r.name}</b>: {r.responded ? 'answered' : 'not answered'}{r.comment ? ` — ${r.comment}` : ''}</li>)}</ul><p className="text-xs text-slate-500 mt-2">This view was written to the audit trail.</p></Card>}
    </div>
  );
};

// ------------------------------------------------------------------ settings

const Settings: React.FC = () => {
  const [cfg, setCfg] = useState<Pm2Config | null>(null);
  const [ver, setVer] = useState(0);
  const { busy, note, run } = useRunner();
  useEffect(() => { p2.get('config').then((x) => { setCfg(x.config); setVer(x.version); }).catch(() => setCfg(DEFAULT_PM2)); }, []);
  if (!cfg) return <p className="text-sm text-slate-500">Loading…</p>;
  const setBand = (i: number, k: 'name' | 'min', v: string) => {
    const old = cfg.bands[i].name;
    const bands = cfg.bands.map((b, j) => (j === i ? { ...b, [k]: k === 'min' ? Number(v) : v } : b));
    const increments = cfg.increments.map((r) => (r.band === old && k === 'name' ? { ...r, band: v } : r));
    setCfg({ ...cfg, bands, increments });
  };
  const setInc = (band: string, k: 'minPct' | 'maxPct', v: string) => setCfg({ ...cfg, increments: cfg.increments.map((r) => (r.band === band ? { ...r, [k]: Number(v) } : r)) });
  const t = cfg.threeSixty;
  return (
    <Card title="Performance 2 settings" subtitle={`Version ${ver || 'default'}. Changes apply to calibration cycles you open from now on; an open cycle keeps its own copy.`}>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <p className="text-sm font-bold text-slate-800 mt-1">Bands and increment ranges</p>
      <div className="space-y-1.5 mt-1">
        {cfg.bands.map((b, i) => {
          const r = cfg.increments.find((x) => x.band === b.name);
          return (
            <div key={i} className="grid grid-cols-[1fr_90px_80px_80px] gap-2 items-center">
              <input className={input} aria-label="Band name" value={b.name} onChange={(e) => setBand(i, 'name', e.target.value)} />
              <input className={input} aria-label="Starts at score" type="number" step={0.1} min={1} max={5} value={b.min} onChange={(e) => setBand(i, 'min', e.target.value)} />
              <input className={input} aria-label="Lowest increment %" type="number" min={0} value={r?.minPct ?? 0} onChange={(e) => setInc(b.name, 'minPct', e.target.value)} />
              <input className={input} aria-label="Highest increment %" type="number" min={0} value={r?.maxPct ?? 0} onChange={(e) => setInc(b.name, 'maxPct', e.target.value)} />
            </div>
          );
        })}
        <p className="text-xs text-slate-500">Columns: band name · starts at score · lowest % · highest %. The lowest band must start at 1.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 mt-4">
        <Field label="Who approves an increment"><select className={input} value={cfg.approval} onChange={(e) => setCfg({ ...cfg, approval: e.target.value as Pm2Config['approval'] })}><option value="HR_THEN_APPROVER">HR, then a second approver</option><option value="HR_ONLY">HR only</option></select></Field>
        <Field label="360 feedback"><select className={input} value={t.enabled ? 'on' : 'off'} onChange={(e) => setCfg({ ...cfg, threeSixty: { ...t, enabled: e.target.value === 'on' } })}><option value="on">On</option><option value="off">Off</option></select></Field>
        <Field label="Fewest reviewers before results show" hint="At least 3."><input className={input} type="number" min={3} value={t.minRaters} onChange={(e) => setCfg({ ...cfg, threeSixty: { ...t, minRaters: Number(e.target.value) } })} /></Field>
        <Field label="Most reviewers"><input className={input} type="number" min={3} max={20} value={t.maxRaters} onChange={(e) => setCfg({ ...cfg, threeSixty: { ...t, maxRaters: Number(e.target.value) } })} /></Field>
        <Field label="Share of behaviour score peers may suggest (%)" hint="0 to 50. The manager's rating is never overridden."><input className={input} type="number" min={0} max={50} value={t.peerSharePct} onChange={(e) => setCfg({ ...cfg, threeSixty: { ...t, peerSharePct: Number(e.target.value) } })} /></Field>
        <Field label="Goals as evidence"><select className={input} value={cfg.goals.enabled ? 'on' : 'off'} onChange={(e) => setCfg({ ...cfg, goals: { enabled: e.target.value === 'on' } })}><option value="on">On</option><option value="off">Off</option></select></Field>
      </div>
      <button className={`${btnPrimary} mt-3`} disabled={busy} onClick={() => run(async () => { const x = await p2.post('config-save', { config: cfg }); setVer(x.version); }, 'Saved. It applies to the next calibration cycle.')}>Save settings</button>
    </Card>
  );
};

// ------------------------------------------------------------------ module

export const Performance2Module: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const [flags, setFlags] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('feedback');
  const loadFlags = useCallback(() => { p2.get('home').then(setFlags).catch(() => setFlags({})); }, []);
  useEffect(() => { loadFlags(); }, [loadFlags]);
  const me = currentUser.authUid || currentUser.id || '';
  const hr = !!flags?.isHr; const approver = !!flags?.isApprover; const manager = !!flags?.isManager;
  const people = (users || []).filter((u: any) => (u.authUid || u.id) !== me && u.active !== false).map((u: any) => ({ uid: u.authUid || u.id, name: u.name || u.email }));
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'feedback', label: flags?.toGive ? `360 feedback (${flags.toGive})` : '360 feedback', show: flags?.threeSixty !== false },
    { key: 'goals', label: 'Goals as evidence', show: flags?.goals !== false },
    { key: 'increments', label: 'Increments', show: manager || hr || approver },
    { key: 'calibration', label: 'Calibration', show: hr || approver },
    { key: 'settings', label: 'Settings', show: hr },
  ];
  const shown = tabs.filter((t) => t.show);
  const current = shown.some((t) => t.key === tab) ? tab : shown[0]?.key;
  return (
    <ToastProvider>
      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl w-full mx-auto">
        <h2 className="text-lg font-extrabold text-slate-900">Performance 2</h2>
        <p className="text-sm text-slate-600 mb-3">Calibration, increments, goals and 360 feedback, on top of your Performance reviews.</p>
        <div role="tablist" className="flex flex-wrap gap-1.5 mb-4">
          {shown.map((t) => <button key={t.key} role="tab" aria-selected={current === t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${current === t.key ? 'bg-[#6d4cf0] border-[#6d4cf0] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{t.label}</button>)}
        </div>
        {current === 'feedback' && <Feedback me={me} hr={hr} refresh={loadFlags} people={people} />}
        {current === 'goals' && <Goals me={me} people={manager || hr ? people : []} />}
        {current === 'increments' && <Increments hr={hr} approver={approver} />}
        {current === 'calibration' && <Calibration />}
        {current === 'settings' && <Settings />}
      </div>
    </ToastProvider>
  );
};
