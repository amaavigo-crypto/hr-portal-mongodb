import React, { createContext, useContext, useMemo } from 'react';
import { EMPTY_OVERRIDES, splitHighlights, textFor, type LandingOverrides } from '../../shared/landingContent';

/**
 * Landing-page wording. Every text on the public site is read through `useT()` / `useRich()` so a platform
 * administrator can change it from the admin screen (see shared/landingContent.ts for the full list).
 */

const ContentContext = createContext<LandingOverrides>(EMPTY_OVERRIDES);

export const ContentProvider: React.FC<{ overrides?: LandingOverrides | null; children: React.ReactNode }> = ({ overrides, children }) => (
  <ContentContext.Provider value={overrides || EMPTY_OVERRIDES}>{children}</ContentContext.Provider>
);

export type TFn = (key: string, vars?: Record<string, string>) => string;

export const useOverrides = (): LandingOverrides => useContext(ContentContext);

/** Plain text for a key (the saved wording, or the built-in default). */
export function useT(): TFn {
  const overrides = useContext(ContentContext);
  return useMemo<TFn>(() => (key, vars) => textFor(key, overrides, vars), [overrides]);
}

/** Shows `*word*` marks as highlighted words. */
export const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {splitHighlights(text).map((p, i) => (p.hl ? <span key={i}>{p.text}</span> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
  </>
);

/** Text for a key with highlight marks turned into highlighted words. */
export function useRich(): (key: string, vars?: Record<string, string>) => React.ReactNode {
  const t = useT();
  return useMemo(() => (key, vars) => <Rich text={t(key, vars)} />, [t]);
}
