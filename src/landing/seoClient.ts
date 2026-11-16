import { resolveSeo, seoKeyForPath, SITE_NAME, type LandingOverrides } from '../../shared/landingContent';

function setTag(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!value) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const meta = (attr: 'name' | 'property', key: string, value: string) =>
  setTag(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  }, 'content', value);

/** Keeps the browser tab title and the search/share tags in step with the page being shown (the server sets them for the first load). */
export function applySeo(path: string, overrides: LandingOverrides | null) {
  const key = seoKeyForPath(path);
  if (!key) return;
  const seo = resolveSeo(key, overrides || { text: {}, seo: {} });
  const url = `${window.location.origin}${path === '/' ? '/' : path}`;
  document.title = seo.title;
  meta('name', 'description', seo.description);
  meta('name', 'robots', seo.noindex ? 'noindex, nofollow' : 'index, follow');
  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', SITE_NAME);
  meta('property', 'og:title', seo.ogTitle);
  meta('property', 'og:description', seo.ogDescription);
  meta('property', 'og:url', url);
  meta('property', 'og:image', seo.ogImage ? new URL(seo.ogImage, window.location.origin).toString() : '');
  meta('name', 'twitter:card', seo.ogImage ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', seo.ogTitle);
  meta('name', 'twitter:description', seo.ogDescription);
  setTag('link[rel="canonical"]', () => {
    const l = document.createElement('link');
    l.setAttribute('rel', 'canonical');
    return l;
  }, 'href', url);
}
