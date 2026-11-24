export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-user-role'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // /api/health used to be its own function; it lives here so it does not use up one of the 12 Vercel Hobby slots.
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  if (path === '/api/health') {
    return res.status(200).json({ status: 'ok', runtime: 'vercel-serverless', timestamp: new Date().toISOString() });
  }

  // File upload and retrieval (no disk on Vercel; see api/_lib/storageApi.ts). Loaded on demand like the landing pages.
  if (path.startsWith('/api/storage/')) {
    const { handleStorage } = await import('./_lib/storageApi.js');
    if (await handleStorage(req, res, path)) return;
  }

  // Landing pages, sitemap and robots.txt arrive here from vercel.json (see api/_lib/landingVercel.ts). Loaded on demand, so a
  // problem there can never affect the rest of the API; the last resort is the plain app page.
  // (Keyed on the helper parameter as well as the path, so it works whichever address Vercel reports for a rewritten request.)
  if (path === '/api/landing' || req.query?.__k) {
    try {
      const { handleLanding } = await import('./_lib/landingVercel.js');
      await handleLanding(req, res);
    } catch (err: any) {
      console.error('[landing] failed:', err?.message || err);
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(307, '/app-shell.html');
      }
    }
    return;
  }

  return res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.url}`,
  });
}
