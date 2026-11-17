import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ChevronLeft, Image as ImageIcon, Loader2, Send, Sparkles, Trash2, UserRound, WifiOff, X } from 'lucide-react';
import { payrollService } from '../../services/payrollService';
import { enqueue, flushQueue, isOffline } from '../../services/claimQueue';
import { shrinkPhoto, type PhotoData } from '../../utils/shrinkPhoto';
import { todayIst } from '../leave/ui';

/**
 * Quick claim: three simple steps that work on a phone.
 * 1) Take photos  2) Check the details  3) Done. With no signal the claim is saved on the phone and sent later.
 */
interface Shot extends PhotoData { kind: 'BILL' | 'PROOF'; takenAt: string; preview: string }
type Step = 'photos' | 'details' | 'done';
const MAX = 6;
const CATS_KEY = 'claimCategories';
const loadCats = (): string[] => { try { return JSON.parse(localStorage.getItem(CATS_KEY) || '[]'); } catch { return []; } };

const bigBtn = 'w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left font-bold text-base active:scale-[0.99] transition';
const fieldCls = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#6d4cf0]';

export const QuickClaim: React.FC<{ onClose: () => void; onSent?: () => void; inApp?: boolean; onViewClaims?: () => void }> = ({ onClose, onSent, inApp, onViewClaims }) => {
  const [step, setStep] = useState<Step>('photos');
  const [shots, setShots] = useState<Shot[]>([]);
  const [cats, setCats] = useState<string[]>(loadCats());
  const [billAbove, setBillAbove] = useState(500);
  const [draftId, setDraftId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [filled, setFilled] = useState<{ vendor: string; unclear: string[]; suggested: string; why: string } | null>(null);
  const [notBill, setNotBill] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIst());
  const [category, setCategory] = useState('');
  const [purpose, setPurpose] = useState('');
  const touched = useRef<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offlineNow, setOfflineNow] = useState(!navigator.onLine);
  const camBill = useRef<HTMLInputElement>(null), camProof = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const up = () => setOfflineNow(false), down = () => setOfflineNow(true);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    payrollService.myClaims().then((r: any) => { setCats(r.categories || []); setBillAbove(r.billRequiredAbove ?? 500); try { localStorage.setItem(CATS_KEY, JSON.stringify(r.categories || [])); } catch { /* storage full */ } }).catch(() => undefined);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const add = async (files: FileList | null, kind: 'BILL' | 'PROOF') => {
    if (!files?.length) return;
    setError('');
    const room = MAX - shots.length;
    if (room <= 0) { setError(`You can add up to ${MAX} photos.`); return; }
    const next: Shot[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      try {
        const p = await shrinkPhoto(f, kind === 'BILL');
        next.push({ ...p, kind, takenAt: new Date().toISOString(), preview: `data:${p.type};base64,${p.data}` });
      } catch (e: any) { setError(e.message); }
    }
    if (next.length) setShots((s) => [...s, ...next]);
  };

  const hasBill = shots.some((s) => s.kind === 'BILL');
  const plain = (s: Shot) => ({ kind: s.kind, name: s.name, type: s.type, data: s.data, takenAt: s.takenAt });

  const toDetails = async () => {
    setStep('details'); setError(''); setNotBill(false); setFilled(null);
    if (!navigator.onLine) return;
    setBusy(true);
    try {
      const { draft } = await payrollService.saveClaimDraft({ files: shots.map(plain) });
      setDraftId(draft.id);
      if (hasBill) {
        setScanning(true);
        payrollService.scanClaimDraft(draft.id).then((r: any) => {
          if (r.notABill) { setNotBill(true); return; }
          if (!r.scanned) return;
          const sc = r.scan;
          if (sc.amount && !touched.current.amount) setAmount(String(sc.amount));
          if (sc.date && !touched.current.date) setDate(sc.date);
          if (r.category && !touched.current.category) setCategory(r.category);
          setFilled({ vendor: sc.vendor || '', unclear: sc.unclear || [], suggested: r.category || '', why: r.categoryReason || '' });
        }).catch(() => undefined).finally(() => setScanning(false));
      }
    } catch (e) { if (!isOffline(e)) setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const backToPhotos = async () => {
    // A draft already saved on the server is removed so the photos can be changed cleanly; the photos stay on the phone.
    if (draftId) { try { await payrollService.withdrawClaim(draftId); } catch { /* it is only a draft */ } setDraftId(''); }
    setStep('photos');
  };

  const problem = (): string => {
    if (!(Number(amount) > 0)) return 'Type the amount you spent.';
    if (!date) return 'Choose the date of the expense.';
    if (!category) return 'Choose what kind of expense this was.';
    if (!purpose.trim()) return 'Say in a few words what it was for (for example: lunch with client at Hotel Sun).';
    if (!hasBill && Number(amount) > billAbove) return `Claims above ₹${billAbove} need a photo of the bill. Go back and add it.`;
    return '';
  };

  const send = async () => {
    const p = problem();
    if (p) { setError(p); return; }
    setBusy(true); setError('');
    const form = { category, amount: Number(amount), expenseDate: date, description: purpose.trim() };
    try {
      let id = draftId;
      if (!id) { const r = await payrollService.saveClaimDraft({ files: shots.map(plain) }); id = r.draft.id; }
      await payrollService.submitClaim({ draftId: id, ...form });
      setOfflineSaved(false); setStep('done'); onSent?.();
    } catch (e) {
      if (isOffline(e)) {
        await enqueue({ files: shots.map(plain), form });
        setOfflineSaved(true); setStep('done');
      } else setError((e as Error).message || 'Could not send. Please try again.');
    } finally { setBusy(false); }
  };

  const sendNow = async () => {
    setBusy(true);
    const r = await flushQueue();
    setBusy(false);
    if (r.left === 0) { setOfflineSaved(false); onSent?.(); } else setError(navigator.onLine ? 'It could not be sent yet. It stays saved on your phone.' : 'Still no signal. It stays saved on your phone.');
  };

  const stepNo = step === 'photos' ? 1 : step === 'details' ? 2 : 3;
  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 flex flex-col" role="dialog" aria-label="Quick claim">
      <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-200">
        {step === 'details' ? <button onClick={backToPhotos} aria-label="Back" className="p-2 -ml-2 rounded-lg active:bg-slate-100"><ChevronLeft className="w-6 h-6" /></button> : <span className="w-6" />}
        <div className="flex-1 text-center">
          <div className="font-extrabold text-slate-900">Quick claim</div>
          <div className="text-xs text-slate-500">Step {stepNo} of 3</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 rounded-lg active:bg-slate-100"><X className="w-6 h-6" /></button>
      </div>
      <div className="h-1 bg-slate-200"><div className="h-1 bg-[#6d4cf0] transition-all" style={{ width: `${stepNo * 33.4}%` }} /></div>
      {offlineNow && step !== 'done' && (
        <div className="flex items-center gap-2 bg-amber-50 text-amber-900 text-sm px-4 py-2"><WifiOff className="w-4 h-4 shrink-0" />No signal. You can still fill this in. It will be saved on your phone and sent when you are back online.</div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-5 max-w-lg w-full mx-auto">
        {step === 'photos' && (
          <div className="space-y-4">
            <h2 className="text-xl font-extrabold text-slate-900">Take your photos</h2>
            <input ref={camBill} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files, 'BILL'); e.target.value = ''; }} />
            <input ref={pick} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void add(e.target.files, 'BILL'); e.target.value = ''; }} />
            <input ref={camProof} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files, 'PROOF'); e.target.value = ''; }} />
            <button onClick={() => camBill.current?.click()} className={`${bigBtn} bg-[#6d4cf0] text-white`}><Camera className="w-7 h-7 shrink-0" /><span>Photo of the bill<span className="block text-sm font-medium opacity-90">Take it with your camera</span></span></button>
            <button onClick={() => camProof.current?.click()} className={`${bigBtn} bg-white border-2 border-slate-200 text-slate-800`}><UserRound className="w-7 h-7 shrink-0 text-[#6d4cf0]" /><span>Photo of you or the place<span className="block text-sm font-medium text-slate-500">Optional. Shows you were there, for example with the client</span></span></button>
            <button onClick={() => pick.current?.click()} className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-[#6d4cf0]"><ImageIcon className="w-5 h-5" />Choose a bill from my phone or a PDF</button>
            {shots.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                {shots.map((s, i) => (
                  <div key={i} className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
                    {s.type === 'application/pdf' ? <div className="h-24 flex items-center justify-center text-xs font-bold text-slate-500">PDF</div> : <img src={s.preview} alt="" className="h-24 w-full object-cover" />}
                    <span className={`absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white ${s.kind === 'BILL' ? 'bg-[#6d4cf0]' : 'bg-slate-700'}`}>{s.kind === 'BILL' ? 'Bill' : 'Proof'}</span>
                    <button onClick={() => setShots((a) => a.filter((_, j) => j !== i))} aria-label="Remove this photo" className="absolute right-1 top-1 rounded-full bg-white/90 p-1.5 shadow"><Trash2 className="w-4 h-4 text-rose-600" /></button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-sm text-rose-700 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
          </div>
        )}

        {step === 'details' && (
          <div className="space-y-4">
            <h2 className="text-xl font-extrabold text-slate-900">Check the details</h2>
            {scanning && <div className="flex items-center gap-2 rounded-xl bg-violet-50 text-violet-900 text-sm px-3 py-3"><Loader2 className="w-4 h-4 animate-spin" />Reading your bill. You can start typing meanwhile.</div>}
            {notBill && <div className="rounded-xl bg-amber-50 text-amber-900 text-sm px-3 py-3">This does not look like a bill. If it is the wrong photo, go back and take it again. Otherwise type the details below.</div>}
            {filled && <div className="flex items-start gap-2 rounded-xl bg-violet-50 text-violet-900 text-sm px-3 py-3"><Sparkles className="w-4 h-4 mt-0.5 shrink-0" /><span>We filled this in from your bill{filled.vendor ? ` (${filled.vendor})` : ''}. Please check it is right before you send.</span></div>}
            <label className="block"><span className="block text-sm font-bold text-slate-700 mb-1">Amount you spent (₹)</span>
              <input inputMode="decimal" className={`${fieldCls} ${filled?.unclear.includes('amount') && !amount ? 'border-amber-400 bg-amber-50' : ''}`} value={amount} placeholder="For example 1200" onChange={(e) => { touched.current.amount = true; setAmount(e.target.value.replace(/[^0-9.]/g, '')); }} />
              {filled?.unclear.includes('amount') && !amount && <span className="text-xs text-amber-700">We could not read this clearly. Please type it.</span>}</label>
            <label className="block"><span className="block text-sm font-bold text-slate-700 mb-1">Date on the bill</span>
              <input type="date" max={todayIst()} className={`${fieldCls} ${filled?.unclear.includes('date') && date === todayIst() ? 'border-amber-400 bg-amber-50' : ''}`} value={date} onChange={(e) => { touched.current.date = true; setDate(e.target.value); }} />
              {filled?.unclear.includes('date') && <span className="text-xs text-amber-700">We could not read the date clearly. Please check it.</span>}</label>
            <label className="block"><span className="block text-sm font-bold text-slate-700 mb-1">What kind of expense?</span>
              <select className={fieldCls} value={category} onChange={(e) => { touched.current.category = true; setCategory(e.target.value); }}>
                <option value="">Choose one</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
              {filled?.suggested && category === filled.suggested && <span className="text-xs text-violet-700">Suggested {filled.why === 'HISTORY' ? 'because your company has claimed from this shop before' : 'from your bill'}. Change it if it is wrong.</span>}</label>
            <label className="block"><span className="block text-sm font-bold text-slate-700 mb-1">What was it for?</span>
              <textarea rows={3} className={fieldCls} maxLength={300} value={purpose} placeholder="For example: lunch with client at Hotel Sun" onChange={(e) => setPurpose(e.target.value)} /></label>
            <p className="text-sm text-slate-500">{shots.filter((s) => s.kind === 'BILL').length} bill and {shots.filter((s) => s.kind === 'PROOF').length} proof photos will go with this claim.</p>
            {error && <p className="text-sm text-rose-700 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
          </div>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4 pt-8">
            {offlineSaved ? <WifiOff className="w-16 h-16 mx-auto text-amber-500" /> : <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500" />}
            <h2 className="text-2xl font-extrabold text-slate-900">{offlineSaved ? 'Saved on your phone' : 'Sent for approval'}</h2>
            <p className="text-slate-600">{offlineSaved ? 'You have no signal right now. Your claim and photos are safe on this phone. It will send by itself when you are back online.' : (inApp ? 'Your manager will look at it. You can follow it under My claims.' : 'Your manager will look at it. You can follow it under Payroll, Claims.')}</p>
            {offlineSaved && <button onClick={sendNow} disabled={busy} className={`${bigBtn} justify-center bg-[#6d4cf0] text-white`}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}Send now</button>}
            {error && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{error}</p>}
            {inApp && onViewClaims && <button onClick={onViewClaims} className="w-full py-3 font-bold text-[#6d4cf0]">See my claims</button>}
            <button onClick={onClose} className="w-full py-3 font-bold text-[#6d4cf0]">{inApp ? 'Done' : 'Close'}</button>
          </div>
        )}
      </div>

      {step !== 'done' && (
        <div className="p-4 bg-white border-t border-slate-200">
          {step === 'photos'
            ? <button disabled={!shots.length || busy} onClick={toDetails} className={`${bigBtn} justify-center ${shots.length ? 'bg-[#6d4cf0] text-white' : 'bg-slate-200 text-slate-400'}`}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null}{shots.length ? 'Next' : 'Add a photo to continue'}</button>
            : <button disabled={busy} onClick={send} className={`${bigBtn} justify-center bg-[#6d4cf0] text-white`}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}Send for approval</button>}
        </div>
      )}
    </div>
  );
};
