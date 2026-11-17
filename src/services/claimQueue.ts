/**
 * Claims saved on the phone while there is no signal. They are kept in the browser (IndexedDB) and sent
 * automatically when the connection returns, when the app is opened, or when the person taps "Send now".
 */
import { payrollService } from './payrollService';
import type { PhotoData } from '../utils/shrinkPhoto';

export interface QueuedFile extends PhotoData { kind: 'BILL' | 'PROOF'; takenAt: string }
export interface QueuedClaim {
  qid: string; savedAt: string; files: QueuedFile[];
  form: { category: string; amount: number; expenseDate: string; description: string };
  error?: string;
}

const DB = 'amaavigo-claims', STORE = 'queue';
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'qid' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const queued = async (): Promise<QueuedClaim[]> => {
  try { return ((await tx('readonly', (s) => s.getAll())) as QueuedClaim[]).sort((a, b) => a.savedAt.localeCompare(b.savedAt)); } catch { return []; }
};
export const enqueue = async (c: Omit<QueuedClaim, 'qid' | 'savedAt'>): Promise<void> => {
  await tx('readwrite', (s) => s.put({ ...c, qid: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toISOString() }));
  notify();
};
const drop = (qid: string) => tx('readwrite', (s) => s.delete(qid));
export const discard = async (qid: string) => { await drop(qid); notify(); };

/** A failed request because there is no connection (as opposed to the server refusing the claim). */
export const isOffline = (e: unknown) => !navigator.onLine || (e instanceof TypeError) || /failed to fetch|network|load failed/i.test(String((e as Error)?.message || ''));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
export const onQueueChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

let flushing = false;
/** Sends everything waiting. A claim the server refuses stays in the list with the reason so the person can fix or delete it. */
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  if (flushing || !navigator.onLine) return { sent: 0, left: (await queued()).length };
  flushing = true;
  let sent = 0;
  try {
    for (const c of await queued()) {
      try {
        const { draft } = await payrollService.saveClaimDraft({ files: c.files });
        if (c.files.some((f) => f.kind === 'BILL')) { try { await payrollService.scanClaimDraft(draft.id); } catch { /* reading the bill is optional */ } }
        await payrollService.submitClaim({ draftId: draft.id, ...c.form });
        await drop(c.qid);
        sent++;
      } catch (e) {
        if (isOffline(e)) break;
        await tx('readwrite', (s) => s.put({ ...c, error: (e as Error).message || 'This claim could not be sent.' }));
      }
    }
  } finally { flushing = false; notify(); }
  return { sent, left: (await queued()).length };
}

export function startAutoSend() {
  const go = () => { void flushQueue(); };
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
  go();
}
