import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';
import { clearLandingCache, loadLandingContent } from '../api/_lib/landingContentApi.ts';
import { buildRobotsTxt, buildSitemapXml, isLandingRequest, renderLandingPage } from '../api/_lib/landingSeo.ts';
import {
  DEFAULT_TEXT,
  FAQ_COUNT,
  FIELDS,
  LANDING_PATHS,
  PAGES,
  SEO_DEFAULTS,
  sanitizeOverrides,
  seoKeyForPath,
  splitHighlights,
  textFor,
} from '../shared/landingContent.ts';

const fdb = new FakeFirestore();
const tok = (claims: any) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'u', email: 'pa@amaavigo.com', ...claims })).toString('base64')}` });
const PLATFORM = tok({ pa: true });
const COMPANY_ADMIN = tok({ cid: 'c1', cs: 'ACTIVE', adm: true, perms: [] });
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

const get = () => routeTenant({ method: 'GET', action: 'landing-content', headers: {}, body: {} });
const save = (headers: any, body: any) => routeTenant({ method: 'POST', action: 'landing-content-save', headers, body });

// --- the registry is consistent -------------------------------------------------------------------------
{
  const keys = new Set(FIELDS.map((f) => f.key));
  assert.equal(keys.size, FIELDS.length, 'no duplicate keys');
  assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_TEXT).sort(), 'every default is listed for the admin screen');
  for (const f of FIELDS) assert.ok(PAGES.some((p) => p.id === f.page), `field ${f.key} belongs to a known page (${f.page})`);
  assert.ok(FIELDS.length > 400, `covers the whole site (${FIELDS.length} texts)`);
  // Every landing path has search-engine defaults within sensible lengths.
  for (const p of LANDING_PATHS) {
    const k = seoKeyForPath(p)!;
    const s = SEO_DEFAULTS[k];
    assert.ok(s, `SEO defaults for ${p}`);
    assert.ok(s.title.length <= 60, `${p} title length ${s.title.length}`);
    assert.ok(s.description.length >= 80 && s.description.length <= 165, `${p} description length ${s.description.length}`);
  }
  assert.equal(FAQ_COUNT, 5);
}

// --- highlight marks and templates ----------------------------------------------------------------------
assert.deepEqual(splitHighlights('Less chasing. More *doing.*'), [{ text: 'Less chasing. More ', hl: false }, { text: 'doing.', hl: true }]);
assert.equal(textFor('home.modules.explore', undefined, { name: 'payroll' }), 'Explore payroll');
assert.equal(textFor('home.hero.eyebrow', { text: { 'home.hero.eyebrow': '   ' }, seo: {} }), DEFAULT_TEXT['home.hero.eyebrow'], 'a blank override means the default');

// --- sanitising -----------------------------------------------------------------------------------------
{
  const s = sanitizeOverrides({
    text: { 'home.hero.eyebrow': '  New wording\u0007  ', 'not.a.key': 'x', 'home.hero.text': DEFAULT_TEXT['home.hero.text'], 'home.why.kicker': 'x'.repeat(5000) },
    seo: { home: { title: 'My title', description: '', ogImage: 'javascript:alert(1)', noindex: true }, bogus: { title: 'x' } },
  });
  assert.equal(s.text['home.hero.eyebrow'], 'New wording', 'trimmed and control characters removed');
  assert.ok(!('not.a.key' in s.text), 'unknown keys are dropped');
  assert.ok(!('home.hero.text' in s.text), 'values equal to the default are not stored');
  assert.equal(s.text['home.why.kicker'].length, 2000, 'long text is cut');
  assert.equal(s.seo.home.title, 'My title');
  assert.equal(s.seo.home.noindex, true);
  assert.ok(!s.seo.home.ogImage, 'a script address is not accepted as an image');
  assert.ok(!('bogus' in s.seo), 'unknown pages are dropped');
}

// --- reading with nothing saved -------------------------------------------------------------------------
{
  const r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.text, {});
}

// --- who may save ---------------------------------------------------------------------------------------
{
  assert.equal((await save({}, { text: {} })).status, 401, 'signed-out people cannot save');
  assert.equal((await save(COMPANY_ADMIN, { text: { 'home.hero.eyebrow': 'Hacked' } })).status, 403, 'a company admin cannot save');
  assert.equal((await get()).json.text['home.hero.eyebrow'], undefined);
}

// --- saving, reading, undo ------------------------------------------------------------------------------
{
  const r1 = await save(PLATFORM, { text: { 'home.hero.eyebrow': 'FIRST WORDING', 'mod.payroll.headline': 'Payroll, *sorted.*' }, seo: { home: { title: 'First title' } } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.canUndo, false);
  assert.equal((await get()).json.text['home.hero.eyebrow'], 'FIRST WORDING');
  assert.ok(fdb.all('platformAudit').some((a) => a.action === 'LANDING_CONTENT_SAVE' && a.by === 'pa@amaavigo.com'), 'the save is recorded');

  const r2 = await save(PLATFORM, { text: { 'home.hero.eyebrow': 'SECOND WORDING' }, seo: {} });
  assert.equal(r2.json.canUndo, true);
  const got = (await get()).json;
  assert.equal(got.text['home.hero.eyebrow'], 'SECOND WORDING');
  assert.ok(!('mod.payroll.headline' in got.text), 'a save replaces the whole set, so cleared fields go back to the default');
  assert.deepEqual(got.seo, {});

  const u = await routeTenant({ method: 'POST', action: 'landing-content-undo', headers: PLATFORM, body: {} });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const back = (await get()).json;
  assert.equal(back.text['home.hero.eyebrow'], 'FIRST WORDING');
  assert.equal(back.seo.home.title, 'First title');
}

// --- the crawler page carries the saved wording ---------------------------------------------------------
{
  const SHELL = '<!doctype html><html><head><title>Old</title><meta name="description" content="old" /><meta property="og:title" content="old" /></head><body><div id="root"></div><script src="/x.js"></script></body></html>';
  await save(PLATFORM, {
    text: { 'home.hero.eyebrow': 'WORDING <FROM> ADMIN', 'mod.payroll.headline': 'Payroll, *sorted.*', 'faq.1.q': 'Is it free?' },
    seo: { home: { title: 'Custom home title', description: 'Custom home description for search.', ogImage: '/share.png' }, 'mod-tasks': { noindex: true } },
  });
  clearLandingCache();
  const ov = await loadLandingContent(true);

  const home = await renderLandingPage(SHELL, '/', ov, 'https://hr.example.com');
  assert.ok(home.includes('<title>Custom home title</title>'));
  assert.equal((home.match(/<title>/g) || []).length, 1, 'one title');
  assert.ok(home.includes('content="Custom home description for search."'));
  assert.ok(!home.includes('content="old"'), 'the shell\'s own description is replaced');
  assert.ok(home.includes('<link rel="canonical" href="https://hr.example.com/" />'));
  assert.ok(home.includes('property="og:image" content="https://hr.example.com/share.png"'));
  assert.ok(home.includes('WORDING &lt;FROM&gt; ADMIN'), 'the saved wording is in the HTML and is escaped');
  assert.ok(!home.includes('WORDING <FROM>'));
  assert.ok(home.includes('Is it free?'), 'FAQ wording is in the HTML');
  assert.ok(home.includes('id="root" data-ssr="1"'));
  assert.ok(home.includes('<h1>All your '), 'the headline is rendered');
  assert.ok(home.includes('application/ld+json'));
  assert.ok(/<script id="landing-content" type="application\/json">.*FROM\\u003e ADMIN|<script id="landing-content"[^>]*>.*\\u003cFROM/s.test(home) || !home.match(/<script id="landing-content"[^>]*>[^<]*<FROM/), 'JSON in the page cannot close the script tag');

  const pay = await renderLandingPage(SHELL, '/modules/payroll', ov, 'https://hr.example.com');
  assert.ok(pay.includes('<h1>Payroll, <span>sorted.</span></h1>'), 'highlight marks become highlighted words');
  assert.ok(pay.includes('BreadcrumbList'));
  assert.ok(pay.includes('<title>Payroll software for India with PF, ESI and TDS | Amaavigo</title>'), 'a page without saved SEO text uses its default');

  const tasks = await renderLandingPage(SHELL, '/modules/tasks', ov, 'https://hr.example.com');
  assert.ok(tasks.includes('content="noindex, nofollow"'));

  for (const p of LANDING_PATHS) {
    const html = await renderLandingPage(SHELL, p, ov, 'https://hr.example.com');
    assert.ok(html.includes('<h1>'), `${p} has a heading`);
    assert.ok(html.length > 8000, `${p} has real content`);
  }
  await assert.rejects(() => renderLandingPage(SHELL, '/login', ov, 'https://hr.example.com'), 'a non-landing path is refused');
  await assert.rejects(() => renderLandingPage('<html><body></body></html>', '/', ov, 'https://x'), 'an unexpected shell is refused, so the caller serves the plain page');

  const sitemap = buildSitemapXml('https://hr.example.com', ov);
  assert.ok(sitemap.includes('<loc>https://hr.example.com/modules/payroll</loc>'));
  assert.ok(!sitemap.includes('/modules/tasks'), 'a page set to noindex is left out of the sitemap');
  assert.ok(buildRobotsTxt('https://hr.example.com').includes('Sitemap: https://hr.example.com/sitemap.xml'));
}

// --- which requests get a pre-rendered page -------------------------------------------------------------
assert.equal(isLandingRequest('/'), true);
assert.equal(isLandingRequest('/modules/payroll'), true);
assert.equal(isLandingRequest('/modules/nothing'), false);
assert.equal(isLandingRequest('/', { offer: 'abc' }), false, 'offer links keep working');
assert.equal(isLandingRequest('/', { screen: 'abc' }), false);
assert.equal(isLandingRequest('/', { test: 'abc' }), false);
assert.equal(isLandingRequest('/login'), false);

console.log('landing content: all checks passed');
