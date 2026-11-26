/**
 * "Who was here lately": one small document per signed-in person (collection `userActivity`, id = their uid):
 *   { uid, companyId, firstSeenAt, lastSeenAt }
 * It feeds the active-user numbers and the quiet-company flags in the Founders Dashboard feed (founderApi.ts).
 * No page, no action and no content is recorded: only that the person made a request, and when.
 *
 * Throttled: a person is written at most once an hour per server process, so the cost is one small write an hour.
 * A failure is swallowed (and retried on the next request): this must never slow down or break a real request.
 */
import { adminDb, __fakeAdminActive } from './firebaseAdmin.js';

const HOUR = 3_600_000;
const MAX_TRACKED = 20_000;
const lastWrite = new Map<string, number>();

/** The write itself. Exported so a test can run it against its own in-memory database. */
export async function recordActivity(database: any, uid: string, companyId: string, nowMs: number): Promise<void> {
  const ref = database.collection('userActivity').doc(uid);
  const snap = await ref.get();
  const first = snap.exists ? (snap.data() as any)?.firstSeenAt : undefined;
  const at = new Date(nowMs).toISOString();
  await ref.set({ uid, companyId, firstSeenAt: first || at, lastSeenAt: at }, { merge: true });
}

export async function touchActivity(uid: string, companyId: string | null | undefined): Promise<void> {
  if (!uid || !companyId) return; // platform administrators have no company
  // Tests that swap in a fake database assert exactly what is written; they opt in with TRACK_ACTIVITY_IN_TESTS=1.
  if (__fakeAdminActive() && process.env.TRACK_ACTIVITY_IN_TESTS !== '1') return;
  const nowMs = Date.now();
  const prev = lastWrite.get(uid);
  if (prev !== undefined && nowMs - prev < HOUR) return;
  if (lastWrite.size >= MAX_TRACKED) lastWrite.clear();
  lastWrite.set(uid, nowMs);
  try {
    await recordActivity(adminDb(), uid, companyId, nowMs);
  } catch {
    lastWrite.delete(uid);
  }
}

/** Test hook: forget the throttle. */
export function __resetActivityThrottle() {
  lastWrite.clear();
}
