/**
 * Landing-page wording and search-engine text, saved by a platform administrator.
 *
 * Stored as one document, `landingContent/site`, holding the overrides as JSON text (keys such as `home.hero.title`
 * contain dots, which database field names cannot). Only differences from the built-in wording are kept, so an
 * empty document means "everything is the default". The previous version is kept so a save can be undone once.
 *
 * Reading is public (it is the public website's own text) and never fails: if the database cannot be reached the
 * built-in wording is returned, so the landing site never goes down because of this feature.
 */
import { randomBytes } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { requirePlatformAdmin } from './authContext.js';
import { EMPTY_OVERRIDES, sanitizeOverrides, type LandingOverrides } from '../../shared/landingContent.js';

const COLLECTION = 'landingContent';
const DOC_ID = 'site';
const CACHE_MS = 60_000;
const ERROR_CACHE_MS = 15_000;

export interface LandingResult {
  status: number;
  json: any;
}

let cache: { at: number; ttl: number; value: LandingOverrides } | null = null;

/** Forget the cached copy (used after a save so this server shows the change at once). */
export function clearLandingCache() {
  cache = null;
}

function parse(raw: unknown, updatedAt?: string, updatedBy?: string): LandingOverrides {
  try {
    const parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
    const clean = sanitizeOverrides(parsed);
    return { ...clean, updatedAt, updatedBy };
  } catch {
    return { ...EMPTY_OVERRIDES };
  }
}

/** The saved wording (cached for a minute). Never throws. */
export async function loadLandingContent(force = false): Promise<LandingOverrides> {
  if (!force && cache && Date.now() - cache.at < cache.ttl) return cache.value;
  try {
    const snap = await adminDb().collection(COLLECTION).doc(DOC_ID).get();
    const d = snap.exists ? (snap.data() as any) : null;
    const value = d ? parse(d.data, d.updatedAt, d.updatedBy) : { ...EMPTY_OVERRIDES };
    cache = { at: Date.now(), ttl: CACHE_MS, value };
    return value;
  } catch (err: any) {
    console.warn('[landing] could not read saved wording, using the built-in text:', err?.message || err);
    const value = cache?.value || { ...EMPTY_OVERRIDES };
    cache = { at: Date.now(), ttl: ERROR_CACHE_MS, value };
    return value;
  }
}

/** GET /api/tenant/landing-content (public). */
export async function getLandingContentRoute(): Promise<LandingResult> {
  const v = await loadLandingContent();
  return { status: 200, json: { success: true, text: v.text, seo: v.seo, updatedAt: v.updatedAt || null, updatedBy: v.updatedBy || null } };
}

/** POST /api/tenant/landing-content-save (platform administrators only). Body: { text, seo } - the complete set to keep. */
export async function saveLandingContentRoute(headers: Record<string, any>, body: any): Promise<LandingResult> {
  const actor = await requirePlatformAdmin(headers);
  const next = sanitizeOverrides(body);
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const before = await ref.get();
  const prev = before.exists ? ((before.data() as any)?.data as string) || '' : '';
  const updatedAt = new Date().toISOString();
  await ref.set({ data: JSON.stringify({ text: next.text, seo: next.seo }), prev, updatedAt, updatedBy: actor.email });
  await db.collection('platformAudit').doc(`aud_${randomBytes(9).toString('hex')}`).set({
    action: 'LANDING_CONTENT_SAVE',
    by: actor.email,
    at: updatedAt,
    textOverrides: Object.keys(next.text).length,
    seoPages: Object.keys(next.seo).length,
  });
  clearLandingCache();
  return { status: 200, json: { success: true, text: next.text, seo: next.seo, updatedAt, updatedBy: actor.email, canUndo: !!prev } };
}

/** POST /api/tenant/landing-content-undo: puts back the version that was saved before the latest one. */
export async function undoLandingContentRoute(headers: Record<string, any>): Promise<LandingResult> {
  const actor = await requirePlatformAdmin(headers);
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() as any) : null;
  if (!d || !d.prev) return { status: 400, json: { success: false, error: 'There is no earlier version to go back to.' } };
  const restored = parse(d.prev);
  const updatedAt = new Date().toISOString();
  await ref.set({ data: d.prev, prev: d.data || '', updatedAt, updatedBy: actor.email });
  await db.collection('platformAudit').doc(`aud_${randomBytes(9).toString('hex')}`).set({ action: 'LANDING_CONTENT_UNDO', by: actor.email, at: updatedAt });
  clearLandingCache();
  return { status: 200, json: { success: true, text: restored.text, seo: restored.seo, updatedAt, updatedBy: actor.email, canUndo: true } };
}
