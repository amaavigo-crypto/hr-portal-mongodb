/** "Download the app" (install to the home screen). The browser offers the install prompt only once, so it is captured here as soon as this file loads. */
import { useEffect, useState } from 'react';

let evt: any = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evt = e; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { evt = null; subs.forEach((f) => f()); });
}

export const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

export function useInstallApp() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    installed: isInstalled(),
    canPrompt: !!evt,
    /** Opens the browser's install box. Returns false when the browser has none (then the person follows the written steps). */
    install: async () => {
      if (!evt) return false;
      evt.prompt();
      await evt.userChoice.catch(() => undefined);
      evt = null; subs.forEach((f) => f());
      return true;
    },
  };
}
