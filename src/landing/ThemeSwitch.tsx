import React, { useEffect, useState } from 'react';

/**
 * TEMPORARY, for demos: a small button that flips the public site between the orange and the purple palette.
 * The choice is remembered in this browser only. To remove it, delete this file, its use in MarketingSite.tsx
 * and the "Temporary demo switch" rules at the end of landing.css.
 */
const KEY = 'lp-theme';
type Theme = 'orange' | 'purple';

const read = (): Theme => {
  try { return localStorage.getItem(KEY) === 'purple' ? 'purple' : 'orange'; } catch { return 'orange'; }
};

export const ThemeSwitch: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('lp-violet-on', theme === 'purple');
    try { localStorage.setItem(KEY, theme); } catch { /* not remembered; still works */ }
    return () => document.documentElement.classList.remove('lp-violet-on');
  }, [theme]);
  return (
    <div className="lp-themeswitch" role="group" aria-label="Site colour">
      <button type="button" aria-pressed={theme === 'orange'} onClick={() => setTheme('orange')}><i style={{ background: '#fa7014' }} />Orange</button>
      <button type="button" aria-pressed={theme === 'purple'} onClick={() => setTheme('purple')}><i style={{ background: '#6d4cf0' }} />Purple</button>
    </div>
  );
};

export default ThemeSwitch;
