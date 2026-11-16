import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import handler from '../api/[...catchall].ts';

// A tiny site that serves the built shell at /app-shell.html, like Vercel does after the build renames index.html.
const SHELL = '<!doctype html><html><head><title>Shell</title><meta name="description" content="shell" /></head><body><div id="root"></div></body></html>';
let shellHits = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/app-shell.html') { shellHits++; res.writeHead(200, { 'content-type': 'text/html' }); res.end(SHELL); } else { res.writeHead(404); res.end(); }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: {} });
fdb.seed('landingContent', 'site', { data: JSON.stringify({ text: { 'home.hero.eyebrow': 'VERCEL WORDING' }, seo: { home: { title: 'Vercel title' } } }), prev: '', updatedAt: '2026-11-16T00:00:00.000Z', updatedBy: 'pa@x.com' });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';
delete process.env.APP_URL;

const call = async (url: string, query: Record<string, string>) => {
  const headers: Record<string, string> = {};
  const out: { status: number; body: string; headers: Record<string, string>; redirect?: string } = { status: 0, body: '', headers };
  const res: any = {
    headersSent: false,
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    status(c: number) { out.status = c; return this; },
    send(b: string) { out.body = b; return this; },
    json(b: any) { out.body = JSON.stringify(b); return this; },
    end() { return this; },
    redirect(c: number, to: string) { out.status = c; out.redirect = to; return this; },
  };
  await handler({ method: 'GET', url, query, headers: { host, 'x-forwarded-proto': 'http' } }, res);
  return out;
};

// the home page, however Vercel reports the request address
for (const url of ['/api/landing?__k=page&__p=/', '/']) {
  const r = await call(url, { __k: 'page', __p: '/' });
  assert.equal(r.status, 200, url);
  assert.ok(r.body.includes('<title>Vercel title</title>'), 'saved title is used');
  assert.ok(r.body.includes('VERCEL WORDING'), 'saved wording is in the HTML');
  assert.ok(r.body.includes(`href="http://${host}/"`), 'canonical uses the request address');
  assert.match(r.headers['cache-control'], /s-maxage=60/);
}
assert.equal(shellHits, 1, 'the shell is fetched once and then cached');

// a module page and a page without saved SEO text
const pay = await call('/modules/payroll', { __k: 'page', __p: '/modules/payroll' });
assert.ok(pay.body.includes('<h1>Payroll that closes without the scramble.</h1>'));

// offer / screening links get the plain shell and are never cached
const offer = await call('/?offer=abc', { __k: 'page', __p: '/', offer: 'abc' });
assert.equal(offer.body, SHELL);
assert.equal(offer.headers['cache-control'], 'no-cache');

// sitemap and robots
const sm = await call('/sitemap.xml', { __k: 'sitemap' });
assert.ok(sm.body.includes(`<loc>http://${host}/modules/payroll</loc>`) && sm.body.includes('<lastmod>2026-11-16</lastmod>'));
const rb = await call('/robots.txt', { __k: 'robots' });
assert.ok(rb.body.includes(`Sitemap: http://${host}/sitemap.xml`));

// the rest of the API is untouched
const health = await call('/api/health', {});
assert.equal(health.status, 200);
assert.ok(health.body.includes('"status":"ok"'));
const unknown = await call('/api/nothing', {});
assert.equal(unknown.status, 404);

// if the shell cannot be fetched, the caller gets a redirect to it rather than an error page
server.close();
const dead = await call('/api/landing', { __k: 'page', __p: '/modules' });
assert.ok(dead.status === 200 || dead.redirect === '/app-shell.html', 'cached shell still works, or the last resort redirect is used');

console.log('landing vercel: all checks passed');
process.exit(0);
