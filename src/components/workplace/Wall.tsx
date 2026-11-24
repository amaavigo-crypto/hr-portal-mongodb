import React, { useCallback, useEffect, useState } from 'react';
import { workplaceService } from '../../services/workplaceService';
import { Card, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const REACTIONS: [string, string][] = [['LIKE', '👍'], ['CELEBRATE', '🎉'], ['INSIGHT', '💡']];

export const Wall: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [next, setNext] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [me, setMe] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('POST');
  const [kudos, setKudos] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => { const r = await workplaceService.feed(); setItems(r.items); setNext(r.next); setCanManage(r.canManage); }, []);
  useEffect(() => { load().catch(() => undefined); workplaceService.directory().then((r) => { setPeople(r.items); setMe(r.me); }).catch(() => undefined); }, [load]);
  const name = (uid: string) => people.find((p) => p.uid === uid)?.name || 'a colleague';

  return (
    <div className="space-y-4 max-w-2xl">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card>
        <div className="flex gap-2 mb-2 text-xs">
          {['POST', 'KUDOS', ...(canManage ? ['ANNOUNCEMENT'] : [])].map((k) => (
            <button key={k} className={`px-3 py-1 rounded-full font-bold ${kind === k ? 'bg-[#6d4cf0] text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setKind(k)}>{k === 'POST' ? 'Post' : k === 'KUDOS' ? 'Kudos' : 'Announcement'}</button>
          ))}
        </div>
        <textarea className={input + ' h-20'} maxLength={2000} placeholder={kind === 'KUDOS' ? 'Say thank you…' : 'Share something with the team…'} value={text} onChange={(e) => setText(e.target.value)} />
        {kind === 'KUDOS' && (
          <select multiple className={input + ' mt-2 h-24'} value={kudos} onChange={(e) => setKudos(Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {people.filter((p) => p.uid !== me).map((p) => <option key={p.uid} value={p.uid}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
          </select>
        )}
        <div className="mt-2 flex justify-end"><button className={btnPrimary} disabled={busy || !text.trim()} onClick={() => run(async () => { await workplaceService.post({ text, kind, kudosTo: kudos }); setText(''); setKudos([]); await load(); })}>Post</button></div>
      </Card>

      {items.map((p) => (
        <Card key={p.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-slate-500"><span className="font-bold text-slate-800">{p.authorName}</span> · {p.createdAt.slice(0, 10)}{p.kind !== 'POST' && <span className="ml-2 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">{p.kind === 'KUDOS' ? 'Kudos' : 'Announcement'}</span>}{p.pinned && <span className="ml-2">📌</span>}</div>
            <div className="flex gap-1">
              {canManage && <button className={btnGhost} onClick={() => run(async () => { await workplaceService.pin(p.id, !p.pinned); await load(); })}>{p.pinned ? 'Unpin' : 'Pin'}</button>}
              {p.canDelete && <button className={btnDanger} onClick={() => run(async () => { await workplaceService.deletePost(p.id); await load(); })}>Delete</button>}
            </div>
          </div>
          {p.kind === 'KUDOS' && <p className="text-xs text-slate-500 mt-1">To {p.kudosTo.map(name).join(', ')}</p>}
          <p className="text-sm text-slate-800 mt-2 whitespace-pre-wrap">{p.text}</p>
          <div className="flex gap-2 mt-3">
            {REACTIONS.map(([k, e]) => (
              <button key={k} className={`px-2.5 py-1 rounded-full text-xs border ${p.myReactions.includes(k) ? 'bg-violet-100 border-violet-300' : 'bg-white border-slate-200'}`} onClick={() => run(async () => { await workplaceService.react(p.id, k); await load(); })}>{e} {p.reactions[k] || ''}</button>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {p.comments.map((c: any) => (
              <div key={c.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2 flex justify-between gap-2">
                <span><b>{c.authorName}</b> {c.text}</span>
                {c.canDelete && <button className="text-rose-600 font-bold" onClick={() => run(async () => { await workplaceService.deleteComment(c.id); await load(); })}>×</button>}
              </div>
            ))}
            <div className="flex gap-2">
              <input className={input} maxLength={500} placeholder="Write a comment…" value={drafts[p.id] || ''} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })} />
              <button className={btnGhost} disabled={busy || !(drafts[p.id] || '').trim()} onClick={() => run(async () => { await workplaceService.comment(p.id, drafts[p.id]); setDrafts({ ...drafts, [p.id]: '' }); await load(); })}>Reply</button>
            </div>
          </div>
        </Card>
      ))}
      {items.length === 0 && <p className="text-sm text-slate-400">Nothing here yet. Be the first to post.</p>}
      {next && <button className={btnGhost} onClick={() => run(async () => { const r = await workplaceService.feed(next); setItems([...items, ...r.items]); setNext(r.next); })}>Older posts</button>}
    </div>
  );
};
