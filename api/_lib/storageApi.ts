/**
 * File upload and retrieval for Vercel, where there is no disk to write to (server.ts keeps using a local folder).
 * Reached as POST /api/storage/upload and GET /api/storage/file/<id>?t=<token> (api/[...catchall].ts hands them over,
 * so no new serverless function slot is used).
 *
 * Files are kept in the `storageFiles` collection (server-only), tagged with the uploader's company.
 * Upload needs a signed-in company user. A file link carries a signed token (the same one server.ts issues), so
 * <img>/<video> tags work without headers.
 * Vercel limits a request body to about 4.5 MB, so larger files are refused with a clear message.
 */
import { requireActiveTenant, authErrorResponse } from './authContext.js';
import { adminDb } from './firebaseAdmin.js';
import { signStorageToken, verifyStorageToken } from './storageToken.js';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const COLLECTION = 'storageFiles';
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, max);

const extFor = (name: string, mime: string) => {
  const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  if (m) return m[0];
  return mime.includes('video') ? '.mp4' : mime.includes('pdf') ? '.pdf' : mime.includes('wordprocessingml') ? '.docx' : mime.includes('png') ? '.png' : mime.includes('jpeg') ? '.jpg' : '.bin';
};

async function upload(req: any, res: any) {
  let ctx;
  try { ctx = await requireActiveTenant(req.headers); } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return res.status(known.status).json(known.json);
    throw err;
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const mimeType = String(b.mimeType || 'application/octet-stream').slice(0, 120);
  let base64 = '';
  if (typeof b.dataUrl === 'string') {
    const i = b.dataUrl.indexOf('base64,');
    if (i < 0) return res.status(400).json({ error: 'dataUrl must be base64 encoded.' });
    base64 = b.dataUrl.slice(i + 7);
  } else if (typeof b.base64 === 'string') base64 = b.base64;
  else return res.status(400).json({ error: 'dataUrl or base64 payload is required' });
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return res.status(400).json({ error: 'The file is empty.' });
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: `This file is ${(buffer.length / 1048576).toFixed(1)} MB. The most that can be uploaded here is ${MAX_UPLOAD_BYTES / 1048576} MB.` });
  }
  const fileName = clean(String(b.fileName || 'media_asset').split(/[\\/]/).pop(), 120) || 'media_asset';
  const documentId = clean(b.documentId || 'doc', 80) || 'doc';
  const fileId = `${documentId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${extFor(fileName, mimeType)}`;
  await adminDb().collection(COLLECTION).doc(fileId).set({
    fileId, companyId: ctx.companyId || '', uploadedBy: ctx.uid, fileName, mimeType, sizeBytes: buffer.length, documentId,
    versionId: b.versionId ? String(b.versionId).slice(0, 120) : '', uploadedAt: new Date().toISOString(), base64: buffer.toString('base64'),
  });
  return res.status(201).json({
    success: true, fileId, fileUrl: `/api/storage/file/${fileId}?t=${signStorageToken(fileId)}`, fileName, mimeType, sizeBytes: buffer.length,
  });
}

async function file(req: any, res: any, fileId: string) {
  const url = new URL(String(req.url || ''), 'http://x');
  if (!verifyStorageToken(fileId, url.searchParams.get('t'))) return res.status(403).json({ error: 'Invalid or missing file link.' });
  const snap = await adminDb().collection(COLLECTION).doc(fileId).get();
  if (!snap.exists) return res.status(404).json({ error: `File not found: ${fileId}` });
  const d = snap.data() as any;
  const buf = Buffer.from(String(d.base64 || ''), 'base64');
  res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${clean(d.fileName, 120)}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers?.range || ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, buf.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start > end || start >= buf.length) { res.setHeader('Content-Range', `bytes */${buf.length}`); return res.status(416).end(); }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return res.status(206).end(buf.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', String(buf.length));
  return res.status(200).end(buf);
}

/** Returns true when it handled the request. */
export async function handleStorage(req: any, res: any, path: string): Promise<boolean> {
  try {
    if (path === '/api/storage/upload') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return true; }
      await upload(req, res); return true;
    }
    const m = /^\/api\/storage\/file\/([^/]+)$/.exec(path);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) { await file(req, res, decodeURIComponent(m[1])); return true; }
  } catch (err: any) {
    console.error('[storage] failed:', err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: err?.message || 'Storage request failed.' });
    return true;
  }
  return false;
}
