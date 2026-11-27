/**
 * /api/email/send | /api/email/test | /api/email/config
 * One function for all three (Vercel's Hobby plan allows at most 12 serverless functions per deployment).
 * Who may send what is decided in api/_lib/emailGate.ts, shared with server.ts.
 */
import { routeEmail } from '../_lib/emailGate.js';

export default async function handler(req: any, res: any) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { status, json } = await routeEmail({ method: req.method, action: String(req.query?.action || ''), body, headers: req.headers });
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] /api/email error:', err);
    return res.status(500).json({ success: false, error: 'Email request failed' });
  }
}
