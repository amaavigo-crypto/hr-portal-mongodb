import React, { useEffect, useState } from 'react';
import { Camera, Download, Loader2, Send, Share, X } from 'lucide-react';
import { QuickClaim } from './QuickClaim';
import { flushQueue, onQueueChange, queued, startAutoSend } from '../../services/claimQueue';

/**
 * The always-there way into a claim: a round Quick claim button on every screen, the app shortcut
 * (/?quick=claim), a note when claims are waiting for signal, and a one-time "install this app" hint.
 */
const HINT_KEY = 'installHintDismissed';
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export const QuickClaimLauncher: React.FC = () => {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('quick') === 'claim');
  const [waiting, setWaiting] = useState(0);
  const [sending, setSending] = useState(false);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (open && new URLSearchParams(window.location.search).has('quick')) window.history.replaceState({}, '', window.location.pathname);
    startAutoSend();
    const count = () => { void queued().then((q) => setWaiting(q.length)); };
    count();
    const off = onQueueChange(count);
    const before = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', before);
    let dismissed = false;
    try { dismissed = localStorage.getItem(HINT_KEY) === '1'; } catch { /* private mode */ }
    if (!dismissed && !isInstalled()) setHint(true);
    return () => { off(); window.removeEventListener('beforeinstallprompt', before); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hideHint = () => { setHint(false); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ } };
  const install = async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => undefined); setInstallEvt(null); hideHint(); } };
  const sendNow = async () => { setSending(true); await flushQueue(); setSending(false); };

  return (
    <>
      {!open && (
        <div className="fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2 print:hidden">
          {waiting > 0 && (
            <button onClick={sendNow} disabled={sending} className="flex items-center gap-2 rounded-full bg-amber-500 text-white pl-4 pr-3 py-2 text-sm font-bold shadow-lg">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{waiting} claim{waiting > 1 ? 's' : ''} saved on your phone. Send now
            </button>
          )}
          {hint && (installEvt || isIos) && (
            <div className="max-w-[18rem] rounded-2xl bg-white border border-slate-200 shadow-lg p-3 text-sm text-slate-700">
              <div className="flex justify-between items-start gap-2"><b className="text-slate-900">Put this on your home screen</b><button onClick={hideHint} aria-label="Dismiss"><X className="w-4 h-4" /></button></div>
              {installEvt
                ? <button onClick={install} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-[#6d4cf0] text-white font-bold py-2"><Download className="w-4 h-4" />Install app</button>
                : <p className="mt-1">Tap <Share className="inline w-4 h-4 -mt-1" /> Share, then <b>Add to Home Screen</b>. Then you can start a claim in one tap.</p>}
            </div>
          )}
          <button onClick={() => setOpen(true)} aria-label="Quick claim" className="flex items-center gap-2 rounded-full bg-[#6d4cf0] text-white pl-4 pr-5 py-3.5 font-bold shadow-xl active:scale-95 transition">
            <Camera className="w-5 h-5" />Quick claim
          </button>
        </div>
      )}
      {open && <QuickClaim onClose={() => setOpen(false)} />}
    </>
  );
};
