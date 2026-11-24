/**
 * E-signature rules. Pure functions, no database.
 *
 * A request is a fixed piece of text sent to one or more people. Each signer types their full name and ticks a consent box;
 * the server records the time, the network address and a SHA-256 hash of the exact text signed. The text cannot change after
 * the request is created, so the hash proves what was signed. This is a simple electronic signature (an acknowledgement with an
 * audit trail), not a digital certificate signature.
 */
export type SignerStatus = 'PENDING' | 'SIGNED' | 'DECLINED';
export type RequestStatus = 'PENDING' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface Signer { uid: string; name: string; email: string; order: number; status: SignerStatus; signedAt?: string; typedName?: string; ip?: string; declineReason?: string }
export interface SignRequestLike { status: RequestStatus; ordered: boolean; expiresAt: string; signers: Signer[] }

export const MAX_SIGNERS = 50;
export const MAX_BODY = 60_000;

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** The typed name must contain every word of the person's name in the same order (so "Asha K Rao" matches "Asha Rao"). */
export function nameMatches(typed: string, actual: string): boolean {
  const t = words(typed), a = words(actual);
  if (!a.length || !t.length) return false;
  let i = 0;
  for (const w of t) if (w === a[i]) i++;
  return i === a.length;
}

export const isExpired = (r: Pick<SignRequestLike, 'expiresAt' | 'status'>, now = Date.now()) => r.status === 'PENDING' && !!r.expiresAt && new Date(r.expiresAt).getTime() < now;

/** The status the request should have, given its signers. A declined signer ends it; all signed completes it. */
export function statusOf(r: SignRequestLike, now = Date.now()): RequestStatus {
  if (r.status === 'CANCELLED') return 'CANCELLED';
  if (r.signers.some((s) => s.status === 'DECLINED')) return 'DECLINED';
  if (r.signers.length > 0 && r.signers.every((s) => s.status === 'SIGNED')) return 'COMPLETED';
  if (isExpired(r, now)) return 'EXPIRED';
  return 'PENDING';
}

/** Whether this person may sign now. With ordered signing, everyone before them must have signed. */
export function canSignNow(r: SignRequestLike, uid: string, now = Date.now()): { ok: boolean; reason?: string } {
  const me = r.signers.find((s) => s.uid === uid);
  if (!me) return { ok: false, reason: 'You are not a signer on this request.' };
  const st = statusOf(r, now);
  if (st !== 'PENDING') return { ok: false, reason: st === 'COMPLETED' ? 'Everyone has already signed.' : st === 'EXPIRED' ? 'This request has expired.' : st === 'CANCELLED' ? 'This request was cancelled.' : 'This request was declined.' };
  if (me.status !== 'PENDING') return { ok: false, reason: me.status === 'SIGNED' ? 'You have already signed.' : 'You have already declined.' };
  if (r.ordered) {
    const before = r.signers.filter((s) => s.order < me.order && s.status !== 'SIGNED');
    if (before.length) return { ok: false, reason: `Waiting for ${before.map((s) => s.name).join(', ')} to sign first.` };
  }
  return { ok: true };
}

/** Signers whose turn it is (everyone pending when not ordered; the lowest pending order when ordered). */
export function whoseTurn(r: SignRequestLike): Signer[] {
  if (statusOf(r) !== 'PENDING') return [];
  const pending = r.signers.filter((s) => s.status === 'PENDING');
  if (!r.ordered) return pending;
  const first = Math.min(...pending.map((s) => s.order));
  return pending.filter((s) => s.order === first);
}

export interface CertificateInput { id: string; title: string; hash: string; createdAt: string; createdByName: string; signers: Signer[] }
export function certificateOf(c: CertificateInput) {
  return {
    id: c.id, title: c.title, documentHash: c.hash, algorithm: 'SHA-256', createdAt: c.createdAt, createdBy: c.createdByName,
    signatures: c.signers.map((s) => ({ name: s.name, email: s.email, typedName: s.typedName || '', signedAt: s.signedAt || '', ip: s.ip || '' })),
    note: 'Simple electronic signatures: each signer typed their name and agreed. The hash identifies the exact text that was signed.',
  };
}
