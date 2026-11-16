import React from 'react';
import { Footer, Header } from './Layout';
import { HomePage, HowItWorksPage, ModuleDetailPage, ModulesPage, SecurityPage, SmartFeaturesPage } from './pages';
import { moduleKeyFromPath } from './routes';

/**
 * The marketing pages with their header and footer, for a given path. It has no effects and reads nothing from the
 * browser, so the server can render it to plain HTML for search engines (see api/_lib/landingSeo.ts) and the
 * browser can show the very same thing (MarketingSite.tsx).
 */
export const MarketingShell: React.FC<{ path: string }> = ({ path }) => {
  const moduleKey = moduleKeyFromPath(path);
  let page: React.ReactNode;
  if (moduleKey) page = <ModuleDetailPage k={moduleKey} />;
  else if (path === '/modules') page = <ModulesPage />;
  else if (path === '/smart-features') page = <SmartFeaturesPage />;
  else if (path === '/security') page = <SecurityPage />;
  else if (path === '/how-it-works') page = <HowItWorksPage />;
  else page = <HomePage />;

  return (
    <div className="lp-root">
      <Header path={path} />
      <main key={path} className="lp-page">{page}</main>
      <Footer />
    </div>
  );
};

export default MarketingShell;
