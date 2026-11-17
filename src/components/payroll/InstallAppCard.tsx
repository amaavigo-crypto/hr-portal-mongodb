import React, { useEffect, useState } from 'react';
import { Camera, Download, Loader2, Send, Share, Smartphone } from 'lucide-react';
import { QuickClaim } from './QuickClaim';
import { flushQueue, onQueueChange, queued } from '../../services/claimQueue';
import { isIos, useInstallApp } from '../../services/installApp';

/** Top of the Claims page: get the phone app, and (once installed) start a claim from the camera. Also shows claims waiting for signal. */
export const InstallAppCard: React.FC<{ onSent?: () => void }> = ({ onSent }) => {
  const { installed, canPrompt, install } = useInstallApp();
  const [steps, setSteps] = useState(false);
  const [quick, setQuick] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const count = () => { void queued().then((q) => setWaiting(q.length)); };
    count();
    return onQueueChange(count);
  }, []);

  const download = async () => { if (!(await install())) setSteps(true); };
  const sendNow = async () => { setSending(true); await flushQueue(); setSending(false); onSent?.(); };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><Smartphone className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-bold text-slate-900">{installed ? 'You are using the app' : 'Claim from your phone'}</div>
          <div className="text-slate-600">{installed ? 'Photograph a bill and send a claim in under a minute, even with no signal.' : 'Download the app, then photograph a bill and send a claim in under a minute, even with no signal.'}</div>
        </div>
        {installed
          ? <button type="button" onClick={() => setQuick(true)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white cursor-pointer"><Camera className="h-4 w-4" />Quick claim</button>
          : <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white cursor-pointer"><Download className="h-4 w-4" />Download app</button>}
        {steps && !installed && !canPrompt && (
          <p className="w-full rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
            {isIos
              ? <>On iPhone: tap <Share className="-mt-1 inline h-4 w-4" /> Share at the bottom of Safari, then choose <b>Add to Home Screen</b>.</>
              : <>Open the Chrome menu (the three dots) and choose <b>Install app</b>. If you only see <b>Add to Home screen</b>, first delete any old Amaavigo icon from your home screen, then in Chrome go to the three dots, Settings, Site settings, and clear this site's data, then open this page again.</>}
          </p>
        )}
      </div>
      {waiting > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1"><b>{waiting} claim{waiting > 1 ? 's' : ''} saved on this phone.</b> They send by themselves when you are online.</span>
          <button type="button" onClick={sendNow} disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 font-bold text-white cursor-pointer">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send now</button>
        </div>
      )}
      {quick && <QuickClaim onClose={() => setQuick(false)} onSent={onSent} />}
    </>
  );
};
