/**
 * Vercel side of the landing-page SEO feature.
 *
 * On Vercel, static files are served before rewrites, so the built `index.html` would always win for "/".
 * The build therefore renames it to `app-shell.html` (see vite.config.ts) and vercel.json sends the landing paths,
 * /sitemap.xml and /robots.txt to `/api/landing?__k=...&__p=...`, which the catch-all function hands to this file.
 * The function fetches the shell from the same site, adds the saved wording and returns it. If anything goes wrong it
 * returns the plain shell, so the site always loads (just without the pre-rendered text).
 */
import { loadLandingContent } from './landingContentApi.js';
import { buildRobotsTxt, buildSitemapXml, isLandingRequest, renderLandingPage, siteOrigin } from './landingSeo.js';
import { normalizePath } from '../../shared/landingContent.js';

let shellCache: { html: string; at: number } | null = null;

async function fetchShell(origin: string): Promise<string> {
  if (shellCache && Date.now() - shellCache.at < 5 * 60_000) return shellCache.html;
  const res = await fetch(`${origin}/app-shell.html`, { headers: { 'x-landing-internal': '1' } });
  if (!res.ok) throw new Error(`Could not load the app shell (${res.status}).`);
  const html = await res.text();
  shellCache = { html, at: Date.now() };
  return html;
}

export async function handleLanding(req: any, res: any): Promise<void> {
  const query = req.query || {};
  const kind = String(query.__k || 'page');
  const origin = siteOrigin(req.headers || {});

  if (kind === 'robots') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(200).send(buildRobotsTxt(origin));
    return;
  }
  if (kind === 'sitemap') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.status(200).send(buildSitemapXml(origin, await loadLandingContent()));
    return;
  }

  const path = normalizePath(String(query.__p || '/'));
  // The page's own query (the original one is passed through by the rewrite), minus our two helper parameters.
  const { __k, __p, ...pageQuery } = query;
  const shell = await fetchShell(origin); // if this fails the caller's catch sends a last-resort response
  let html = shell;
  if (isLandingRequest(path, pageQuery)) {
    try {
      html = await renderLandingPage(shell, path, await loadLandingContent(), origin);
    } catch (err: any) {
      console.warn('[landing] could not pre-render, serving the plain page:', err?.message || err);
    }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Visitors with an offer / screening / test link must always get fresh HTML; landing pages can be cached briefly at the edge.
  res.setHeader('Cache-Control', Object.keys(pageQuery).length ? 'no-cache' : 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(html);
}
