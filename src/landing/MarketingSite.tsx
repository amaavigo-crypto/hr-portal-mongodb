import React, { useEffect, useState } from 'react';
import './landing.css';
import type { LandingOverrides } from '../../shared/landingContent';
import { ContentProvider } from './content';
import { MarketingShell } from './MarketingShell';
import { NAVIGATE_EVENT, isMarketingPath, normalizePath } from './routes';
import { applySeo } from './seoClient';

/** The server puts the saved wording into the page (see api/_lib/landingSeo.ts); read it so the first paint matches what search engines saw. */
function readInjectedContent(): LandingOverrides | null {
  try {
    const raw = document.getElementById('landing-content')?.textContent;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { text: parsed.text || {}, seo: parsed.seo || {}, updatedAt: parsed.updatedAt } : null;
  } catch {
    return null;
  }
}

/**
 * The public marketing site: several pages, one shell. It keeps its own current path and moves
 * between pages with the History API, so going from page to page never reloads the app.
 */
export const MarketingSite: React.FC = () => {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [overrides, setOverrides] = useState<LandingOverrides | null>(() => readInjectedContent());

  useEffect(() => {
    const sync = () => {
      const next = normalizePath(window.location.pathname);
      // A path that is not a marketing page belongs to the app (sign-in); let the app take over.
      if (!isMarketingPath(next)) {
        window.location.reload();
        return;
      }
      setPath(next);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  // No wording came with the page (development, or the server could not add it): ask for it. Without an answer the built-in wording shows.
  useEffect(() => {
    if (overrides) return;
    let cancelled = false;
    fetch('/api/tenant/landing-content', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.success) setOverrides({ text: j.text || {}, seo: j.seo || {}, updatedAt: j.updatedAt });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [overrides]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path]);

  useEffect(() => {
    applySeo(path, overrides);
  }, [path, overrides]);

  return (
    <ContentProvider overrides={overrides}>
      <MarketingShell path={path} />
    </ContentProvider>
  );
};

export default MarketingSite;
