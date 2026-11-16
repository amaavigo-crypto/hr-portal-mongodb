import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LandingOverrides } from '../../shared/landingContent';
import { ContentProvider } from './content';
import { MarketingShell } from './MarketingShell';

/**
 * Server-side: the HTML of one landing page with the saved wording already in it, so search engines and link
 * previews read the real text without running any JavaScript. The browser replaces it with the live page.
 */
export function renderLandingHtml(path: string, overrides: LandingOverrides): string {
  return renderToStaticMarkup(
    <ContentProvider overrides={overrides}>
      <MarketingShell path={path} />
    </ContentProvider>,
  );
}
