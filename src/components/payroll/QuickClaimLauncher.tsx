import React, { useEffect, useState } from 'react';
import { QuickClaim } from './QuickClaim';
import { startAutoSend } from '../../services/claimQueue';
import '../../services/installApp';

/**
 * Runs in the background for every signed-in person: sends claims saved on the phone when signal returns, and opens
 * Quick claim when the app is started from its home-screen shortcut (/?quick=claim). It draws no button of its own.
 */
export const QuickClaimLauncher: React.FC = () => {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('quick') === 'claim');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('quick')) window.history.replaceState({}, '', window.location.pathname);
    startAutoSend();
  }, []);
  return open ? <QuickClaim onClose={() => setOpen(false)} /> : null;
};
