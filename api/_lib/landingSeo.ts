/**
 * Search-engine view of the public landing site.
 *
 * `renderLandingPage` takes the built app shell (dist/index.html) and returns it with, for one landing path:
 *   - the page title, description, canonical address, Open Graph / Twitter tags and structured data from the saved wording
 *   - the page's real text already in the HTML (the same React page the browser shows, rendered on the server)
 *   - the saved wording as JSON so the browser's first paint matches
 * The browser then replaces the pre-rendered markup with the live page. If anything here fails the caller serves the
 * plain shell, so the site always loads.
 */
import { configuredSiteUrl } from './appUrl.js';
import {
  LANDING_PATHS,
  MODULE_KEYS,
  SITE_NAME,
  normalizePath,
  resolveSeo,
  seoKeyForPath,
  stripHighlights,
  textFor,
  type LandingOverrides,
} from '../../shared/landingContent.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));

/** Public address of the site: APP_URL if set, otherwise the address the request came in on. */
export function siteOrigin(headers: Record<string, any>, fallbackProto = 'https'): string {
  const fromEnv = configuredSiteUrl();
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  const proto = String(headers['x-forwarded-proto'] || fallbackProto).split(',')[0].trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

/** True for a request that should get a pre-rendered landing page (not the offer, screening or test links, which also live at "/"). */
export function isLandingRequest(path: string, query: Record<string, any> = {}): boolean {
  if ('offer' in query || 'screen' in query || 'test' in query) return false;
  return seoKeyForPath(path) !== null;
}

function structuredData(path: string, origin: string, seo: { title: string; description: string }, overrides: LandingOverrides): string {
  const url = `${origin}${path === '/' ? '/' : path}`;
  const graph: any[] = [{ '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE_NAME, url: `${origin}/` }];
  if (path === '/') {
    graph.push({ '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: SITE_NAME, publisher: { '@id': `${origin}/#organization` } });
  }
  graph.push({ '@type': 'WebPage', '@id': `${url}#webpage`, url, name: seo.title, description: seo.description, isPartOf: { '@id': `${origin}/#website` } });
  const m = /^\/modules\/([a-z-]+)$/.exec(path);
  if (m) {
    const name = textFor(`mod.${m[1]}.name`, overrides);
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: textFor('tpl.mod.crumb.home', overrides), item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: textFor('tpl.mod.crumb.modules', overrides), item: `${origin}/modules` },
        { '@type': 'ListItem', position: 3, name, item: url },
      ],
    });
  }
  return `<script type="application/ld+json">${jsonForScript({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
}

function headTags(path: string, origin: string, overrides: LandingOverrides): { title: string; tags: string } {
  const key = seoKeyForPath(path)!;
  const seo = resolveSeo(key, overrides);
  const url = `${origin}${path === '/' ? '/' : path}`;
  const image = seo.ogImage ? (/^https?:\/\//i.test(seo.ogImage) ? seo.ogImage : `${origin}${seo.ogImage.startsWith('/') ? '' : '/'}${seo.ogImage}`) : '';
  const t: string[] = [
    `<meta name="description" content="${esc(seo.description)}" />`,
    `<meta name="robots" content="${seo.noindex ? 'noindex, nofollow' : 'index, follow'}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(seo.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(seo.ogDescription)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
  ];
  if (image) t.push(`<meta property="og:image" content="${esc(image)}" />`);
  t.push(
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(seo.ogTitle)}" />`,
    `<meta name="twitter:description" content="${esc(seo.ogDescription)}" />`,
  );
  if (image) t.push(`<meta name="twitter:image" content="${esc(image)}" />`);
  t.push(structuredData(path, origin, seo, overrides));
  return { title: seo.title, tags: t.join('\n    ') };
}

/** Removes the tags the app shell ships with, so the page's own replace them instead of doubling up. */
function stripShellSeo(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+property=["']og:[^"']*["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']*["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '');
}

/** The shell with this landing page's tags and text in it. Throws if the page cannot be rendered. */
export async function renderLandingPage(shell: string, urlPath: string, overrides: LandingOverrides, origin: string): Promise<string> {
  const path = normalizePath(urlPath);
  if (!seoKeyForPath(path)) throw new Error(`Not a landing page: ${path}`);
  // Loaded only when needed, so a problem with the page code can never stop the rest of the server from starting.
  const { renderLandingHtml } = await import('../../src/landing/ssr.tsx');
  const body = renderLandingHtml(path, overrides);
  const { title, tags } = headTags(path, origin, overrides);

  const head = [
    `<title>${esc(title)}</title>`,
    tags,
    // The pre-rendered text is for search engines and link previews. It stays hidden until the live page takes over, so signed-in people never see a flash of the marketing page.
    `<style>#root[data-ssr]{visibility:hidden}</style>`,
    `<script id="landing-content" type="application/json">${jsonForScript({ text: overrides.text, seo: overrides.seo, updatedAt: overrides.updatedAt })}</script>`,
  ].join('\n    ');

  let html = stripShellSeo(shell);
  if (!/<div id="root"><\/div>/.test(html) || !/<\/head>/i.test(html)) throw new Error('Unexpected app shell: no empty #root or </head>.');
  html = html.replace(/<\/head>/i, `    ${head}\n  </head>`);
  html = html.replace('<div id="root"></div>', () => `<div id="root" data-ssr="1">${body}</div>`);
  return html;
}

export function buildRobotsTxt(origin: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /login', 'Disallow: /onboarding/', origin ? `Sitemap: ${origin}/sitemap.xml` : ''].filter(Boolean).join('\n') + '\n';
}

export function buildSitemapXml(origin: string, overrides: LandingOverrides): string {
  const lastmod = overrides.updatedAt ? overrides.updatedAt.slice(0, 10) : '';
  const urls = LANDING_PATHS.filter((p) => !resolveSeo(seoKeyForPath(p)!, overrides).noindex).map((p) => {
    const priority = p === '/' ? '1.0' : p.startsWith('/modules/') ? '0.7' : '0.8';
    return `  <url><loc>${esc(`${origin}${p === '/' ? '/' : p}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority></url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// Re-exported so server code has one place to import landing helpers from.
export { stripHighlights, MODULE_KEYS };
