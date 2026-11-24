import React, { useCallback, useEffect, useState } from 'react';
import { inr } from '../../services/payrollService';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const tone: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-rose-100 text-rose-800', CANCELLED: 'bg-slate-200 text-slate-600' };
const Pill: React.FC<{ s: string }> = ({ s }) => <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${tone[s] || ''}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>;

const Detail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [d, setD] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const { busy, note: msg, run } = useRunner();
  const load = useCallback(() => workplaceService.requestDetail(id).then(setD), [id]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  const r = d.request;
  return (
    <div className="space-y-3 max-w-3xl">
      <button className={btnGhost} onClick={onBack}>‹ Back</button>
      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice>}
      <Card title={<span className="flex items-center gap-2">{r.title} <Pill s={r.status} /></span>} subtitle={`${r.requesterName} · ${r.kind}${r.amount ? ` · ${inr(r.amount)}` : ''} · ${r.chainName}`}>
        {r.details && <p className="text-sm text-slate-700 whitespace-pre-wrap mb-3">{r.details}</p>}
        <ol className="space-y-2">{r.steps.map((s: any, i: number) => (
          <li key={i} className="text-xs border border-slate-200 rounded-lg p-2"><b>{s.name}</b> <Pill s={s.status === 'WAITING' ? 'PENDING' : s.status} />{s.status === 'WAITING' && <span className="text-slate-400"> (not yet)</span>}
            <div className="text-slate-600 mt-1">{s.approvers.map((a: any) => `${a.name}${a.approved ? ' ✓' : ''}`).join(s.mode === 'ALL' ? ' and ' : ' or ')}</div></li>))}</ol>
        {d.canDecide.ok && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1"><Field label="Note (needed to reject)"><input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.decideRequest(id, true, note); await load(); })}>Approve</button>
            <button className={btnDanger} disabled={busy || !note.trim()} onClick={() => run(async () => { await workplaceService.decideRequest(id, false, note); await load(); })}>Reject</button>
          </div>
        )}
        <ul className="mt-3 text-[11px] text-slate-500 space-y-0.5">{r.history.map((h: any, i: number) => <li key={i}>{h.at.slice(0, 16).replace('T', ' ')} · {h.action.toLowerCase()}{h.step ? ` (${h.step})` : ''}{h.name ? ` · ${h.name}` : ''}{h.note ? ` · ${h.note}` : ''}</li>)}</ul>
        {r.status === 'PENDING' && r.requesterName && <div className="mt-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await workplaceService.cancelRequest(id); await load(); })}>Cancel request</button></div>}
      </Card>
    </div>
  );
};

const ChainBuilder: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [draft, setDraft] = useState<any | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => workplaceService.approvalChains().then((r) => setItems(r.items)), []);
  useEffect(() => { load().catch(() => undefined); workplaceService.directory().then((r) => setPeople(r.items)).catch(() => undefined); }, [load]);
  const step = (i: number, p: any) => setDraft({ ...draft, steps: draft.steps.map((s: any, j: number) => (j === i ? { ...s, ...p } : s)) });
  const personName = (u: string) => people.find((p) => p.uid === u)?.name || '';
  return (
    <Card title="Approval chains" subtitle="Which requests go to whom. The right chain is picked by kind and amount." right={!draft && <button className={btnPrimary} onClick={() => setDraft({ name: '', kind: '', minAmount: 0, active: true, steps: [{ name: 'Manager', approver: 'MANAGER', mode: 'ANY', uids: [] }], fallbackUids: [] })}>New chain</button>}>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {draft && (
        <div className="border border-slate-200 rounded-xl p-3 mb-3 space-y-2">
          <div className="grid md:grid-cols-4 gap-2">
            <Field label="Name"><input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Kind of request" hint="for example purchase, travel"><input className={input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} /></Field>
            <Field label="Applies from amount (₹)"><input type="number" className={input} value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: Number(e.target.value) })} /></Field>
            <label className="flex items-end gap-2 text-xs pb-2"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
          </div>
          {draft.steps.map((s: any, i: number) => (
            <div key={i} className="grid md:grid-cols-[1fr_11rem_1fr_6rem_auto] gap-2 items-end">
              <Field label={`Step ${i + 1} name`}><input className={input} value={s.name} onChange={(e) => step(i, { name: e.target.value })} /></Field>
              <Field label="Approver"><select className={input} value={s.approver} onChange={(e) => step(i, { approver: e.target.value })}><option value="MANAGER">Reporting manager</option><option value="SKIP_LEVEL">Manager's manager</option><option value="PEOPLE">Specific people</option></select></Field>
              {s.approver === 'PEOPLE' ? <Field label="People"><select multiple className={input + ' h-20'} value={s.uids} onChange={(e) => step(i, { uids: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field> : <div />}
              {s.approver === 'PEOPLE' ? <Field label="Need"><select className={input} value={s.mode} onChange={(e) => step(i, { mode: e.target.value })}><option value="ANY">Any one</option><option value="ALL">All</option></select></Field> : <div />}
              {draft.steps.length > 1 && <button className={btnDanger} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_: any, j: number) => j !== i) })}>×</button>}
            </div>
          ))}
          <Field label="Fallback approvers (used when a manager is missing)"><select multiple className={input + ' h-16'} value={draft.fallbackUids} onChange={(e) => setDraft({ ...draft, fallbackUids: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { name: `Step ${draft.steps.length + 1}`, approver: 'MANAGER', mode: 'ANY', uids: [] }] })}>Add step</button>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.saveChain(draft); setDraft(null); await load(); })}>Save</button><button className={btnGhost} onClick={() => setDraft(null)}>Cancel</button></div>
        </div>
      )}
      {items.map((c) => (
        <div key={c.id} className="flex items-center justify-between border-t border-slate-100 py-2 text-xs">
          <span><b>{c.name}</b> · {c.kind} from {inr(c.minAmount)}{!c.active && ' · inactive'}<span className="block text-slate-500">{c.steps.map((s: any) => `${s.name} (${s.approver === 'PEOPLE' ? s.uids.map(personName).join(', ') : s.approver === 'MANAGER' ? 'manager' : "manager's manager"})`).join(' → ')}</span></span>
          <span className="flex gap-1"><button className={btnGhost} onClick={() => setDraft({ ...c })}>Edit</button><button className={btnDanger} disabled={busy} onClick={() => run(async () => { await workplaceService.deleteChain(c.id); await load(); })}>Delete</button></span>
        </div>
      ))}
      {items.length === 0 && !draft && <p className="text-sm text-slate-400">No chains yet.</p>}
    </Card>
  );
};

export const Approvals: React.FC<{ canBuild: boolean }> = ({ canBuild }) => {
  const [inbox, setInbox] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [kinds, setKinds] = useState<any[]>([]);
  const [open, setOpen] = useState('');
  const [form, setForm] = useState({ kind: '', title: '', amount: '', details: '' });
  const { busy, note, run } = useRunner();
  const load = useCallback(async () => {
    const [i, m, k] = await Promise.all([workplaceService.approvalInbox(), workplaceService.myRequests(), workplaceService.approvalKinds()]);
    setInbox(i.items); setMine(m.items); setKinds(k.items);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (open) return <Detail id={open} onBack={() => { setOpen(''); load(); }} />;
  const list = (title: string, rows: any[]) => rows.length > 0 && (
    <Card title={title}>{rows.map((r) => (
      <button key={r.id} className="w-full text-left flex items-center justify-between py-2 border-t border-slate-100 first:border-0" onClick={() => setOpen(r.id)}>
        <span className="text-sm font-semibold text-slate-800">{r.title}<span className="block text-xs font-normal text-slate-500">{r.requesterName} · {r.kind}{r.amount ? ` · ${inr(r.amount)}` : ''} · {r.createdAt.slice(0, 10)}</span></span><Pill s={r.status} />
      </button>))}</Card>
  );
  return (
    <div className="space-y-4 max-w-3xl">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {list('Waiting for your decision', inbox)}
      {kinds.length > 0 && (
        <Card title="New request">
          <div className="grid md:grid-cols-4 gap-2">
            <Field label="Kind"><select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="">Choose…</option>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind}</option>)}</select></Field>
            <div className="md:col-span-2"><Field label="Title"><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
            <Field label="Amount (₹)"><input type="number" className={input} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <div className="md:col-span-4"><Field label="Details"><textarea className={input + ' h-16'} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field></div>
          </div>
          <div className="mt-2"><button className={btnPrimary} disabled={busy || !form.kind || !form.title.trim()} onClick={() => run(async () => { await workplaceService.submitRequest({ ...form, amount: Number(form.amount || 0) }); setForm({ kind: form.kind, title: '', amount: '', details: '' }); await load(); })}>Send for approval</button></div>
        </Card>
      )}
      {list('Your requests', mine)}
      {canBuild && <ChainBuilder />}
      {!inbox.length && !mine.length && !kinds.length && !canBuild && <p className="text-sm text-slate-400">No approval flows are set up yet.</p>}
    </div>
  );
};
