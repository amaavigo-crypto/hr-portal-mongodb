import React, { useCallback, useEffect, useState } from 'react';
import { workplaceService } from '../../services/workplaceService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const tone: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-800', COMPLETED: 'bg-emerald-100 text-emerald-800', DECLINED: 'bg-rose-100 text-rose-800', CANCELLED: 'bg-slate-200 text-slate-600', EXPIRED: 'bg-slate-200 text-slate-600' };
const Pill: React.FC<{ s: string }> = ({ s }) => <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${tone[s] || ''}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>;

const Detail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [d, setD] = useState<any | null>(null);
  const [typed, setTyped] = useState('');
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [intact, setIntact] = useState<boolean | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => workplaceService.esignGet(id).then(setD), [id]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  const r = d.request;
  return (
    <div className="space-y-3 max-w-3xl">
      <button className={btnGhost} onClick={onBack}>‹ Back</button>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title={<span className="flex items-center gap-2">{r.title} <Pill s={r.status} /></span>} subtitle={`Sent by ${r.createdByName} · expires ${r.expiresAt.slice(0, 10)}`}>
        <pre className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-80 overflow-y-auto font-sans">{r.body}</pre>
        <p className="text-[11px] text-slate-400 mt-2 break-all">Document fingerprint (SHA-256): {r.docHash}</p>
        <table className="text-xs w-full mt-3"><tbody>{r.signers.map((s: any) => <tr key={s.uid} className="border-t border-slate-100"><td className="p-1.5 font-semibold">{s.name}</td><td className="p-1.5">{s.status === 'SIGNED' ? `Signed ${s.signedAt.slice(0, 16).replace('T', ' ')}` : s.status === 'DECLINED' ? 'Declined' : 'Waiting'}</td></tr>)}</tbody></table>
        {d.canSign.ok && (
          <div className="mt-4 border-t border-slate-200 pt-3 space-y-2">
            <Field label="Type your full name to sign"><input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={r.mine?.name} /></Field>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I have read this document and agree to sign it electronically.</label>
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy || !consent || !typed.trim()} onClick={() => run(async () => { await workplaceService.esignSign(id, typed, consent); await load(); })}>Sign</button>
              <input className={input + ' max-w-xs'} placeholder="Reason, if declining" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className={btnDanger} disabled={busy || !reason.trim()} onClick={() => run(async () => { await workplaceService.esignDecline(id, reason); await load(); })}>Decline</button>
            </div>
          </div>
        )}
        {!d.canSign.ok && r.mine && <p className="text-xs text-slate-500 mt-3">{d.canSign.reason}</p>}
        <div className="mt-3 flex gap-2">
          <button className={btnGhost} onClick={() => workplaceService.esignVerify(id).then((v) => setIntact(v.intact))}>Check the text is unchanged</button>
          {intact !== null && <span className={`text-xs font-bold py-2 ${intact ? 'text-emerald-700' : 'text-rose-700'}`}>{intact ? 'Unchanged since it was sent' : 'The text has been altered'}</span>}
          {r.status === 'PENDING' && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await workplaceService.esignCancel(id); await load(); })}>Cancel request</button>}
        </div>
      </Card>
      {d.certificate && <Card title="Signing certificate"><pre className="text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto">{JSON.stringify(d.certificate, null, 2)}</pre><button className={btnGhost + ' mt-2'} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(d.certificate, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `certificate-${id}.json`; a.click(); URL.revokeObjectURL(url); }}>Download</button></Card>}
    </div>
  );
};

export const ESign: React.FC = () => {
  const [m, setM] = useState<any | null>(null);
  const [open, setOpen] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [draft, setDraft] = useState<any | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => workplaceService.esignMine().then(setM), []);
  useEffect(() => { load().catch(() => undefined); workplaceService.directory().then((r) => setPeople(r.items)).catch(() => undefined); }, [load]);
  if (open) return <Detail id={open} onBack={() => { setOpen(''); load(); }} />;
  if (!m) return <p className="text-sm text-slate-400">Loading…</p>;
  const list = (title: string, rows: any[]) => rows.length > 0 && (
    <Card title={title}>
      {rows.map((x) => (
        <button key={x.id} className="w-full text-left flex items-center justify-between py-2 border-t border-slate-100 first:border-0" onClick={() => setOpen(x.id)}>
          <span className="text-sm font-semibold text-slate-800">{x.title}<span className="block text-xs font-normal text-slate-500">{x.createdByName} · {x.createdAt.slice(0, 10)} · {x.signers.filter((s: any) => s.status === 'SIGNED').length}/{x.signers.length} signed</span></span>
          <Pill s={x.status} />
        </button>
      ))}
    </Card>
  );
  return (
    <div className="space-y-4 max-w-3xl">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {m.canManage && !draft && <button className={btnPrimary} onClick={() => setDraft({ title: '', body: '', signerUids: [], ordered: false, expiresInDays: 30 })}>Send a document for signature</button>}
      {draft && (
        <Card title="New signature request" right={<button className={btnGhost} onClick={() => setDraft(null)}>Cancel</button>}>
          <Field label="Title"><input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <div className="mt-2"><Field label="Text to be signed" hint="It cannot be changed after sending."><textarea className={input + ' h-40'} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field></div>
          <div className="mt-2"><Field label="Signers (hold Ctrl or Cmd to pick several; the order picked is the signing order)"><select multiple className={input + ' h-32'} value={draft.signerUids} onChange={(e) => { const sel = Array.from(e.target.selectedOptions).map((o) => o.value); setDraft({ ...draft, signerUids: [...draft.signerUids.filter((u: string) => sel.includes(u)), ...sel.filter((u) => !draft.signerUids.includes(u))] }); }}>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field></div>
          <div className="mt-2 flex items-center gap-4 text-xs"><label><input type="checkbox" checked={draft.ordered} onChange={(e) => setDraft({ ...draft, ordered: e.target.checked })} /> One after another, in this order</label><label>Expires in <input type="number" className="w-16 border border-slate-300 rounded px-1 py-0.5" value={draft.expiresInDays} onChange={(e) => setDraft({ ...draft, expiresInDays: Number(e.target.value) })} /> days</label></div>
          <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await workplaceService.esignCreate(draft); setDraft(null); await load(); })}>Send</button></div>
        </Card>
      )}
      {list('Waiting for your signature', m.toSign)}{list('Waiting for others', m.waiting)}{list('Sent by you', m.sent)}{list('Done', m.done)}
      {!m.toSign.length && !m.waiting.length && !m.sent.length && !m.done.length && <p className="text-sm text-slate-400">Nothing to sign.</p>}
    </div>
  );
};
