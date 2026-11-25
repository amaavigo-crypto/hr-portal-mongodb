/**
 * Document Version Control agent: tool registry, the pure rules and the wording that must NOT be left to the model.
 * Pure code (no database, no network), tested in tests/documentAgent.test.ts.
 *
 * Read only, on purpose. Approving, publishing and reminding happen on the screens today, without a server-side permission
 * check of their own, so the agent does not do them. What it keeps from the module's rules:
 *   - an employee only ever sees PUBLISHED text of documents they may read; drafts and documents in review never reach them
 *   - people who only create documents see their own queue; reviewers and publishers see all of it
 *   - acknowledging stays a click by the person on Home; the agent never does it for anyone
 *
 * `access`:  all         every signed-in person (the data is limited to what they may read)
 *            review      doc.create / doc.review / doc.publish (or company admin)
 *            compliance  compliance.view / doc.publish (or company admin): who has and has not acknowledged
 * This only decides which tools the model is told about. The security boundary is in api/_lib/documentAgent.ts, which checks
 * company and permission again on every call.
 */
import { hasAnyPerm } from './permissions.js';
import { addDays, cleanText, daysBetween } from './leaveAgentTools.js';

export type DocumentToolAccess = 'all' | 'review' | 'compliance';
export interface DocumentAgentTool { name: string; kind: 'read'; access: DocumentToolAccess; description: string; parameters: Record<string, any> }

const none = { type: 'object', properties: {}, additionalProperties: false };

export const DOCUMENT_AGENT_TOOLS: DocumentAgentTool[] = [
  {
    name: 'get_my_acknowledgements', kind: 'read', access: 'all',
    description: 'The policies the signed-in person still has to acknowledge, and the ones they have already acknowledged. Use it for "what do I need to acknowledge" or "did I acknowledge the leave policy". The person acknowledges on the Home page; you cannot do it for them.',
    parameters: none,
  },
  {
    name: 'get_policy_changes', kind: 'read', access: 'all',
    description: 'What changed between the current published version of a policy and the version before it: added and removed passages, the author\'s change summary, and the dates. Only published documents this person may read. Use it for "what changed in the leave policy".',
    parameters: { type: 'object', properties: { document: { type: 'string', description: 'Title or document code, e.g. "Code of Conduct" or "AMA-HR-POL-001".' } }, required: ['document'], additionalProperties: false },
  },
  {
    name: 'get_review_queue', kind: 'read', access: 'review',
    description: 'Document versions waiting for review, and versions sent back for revision, with who created them and how long ago. Reviewers and publishers see all; people who only create documents see their own.',
    parameters: none,
  },
  {
    name: 'get_document_health', kind: 'read', access: 'review',
    description: 'Published documents whose review date has passed or is coming up in 30 days, and documents that have expired or expire in 30 days. Use it for "which policies are overdue for review".',
    parameters: none,
  },
  {
    name: 'get_acknowledgement_status', kind: 'read', access: 'compliance',
    description: 'For published documents that need acknowledgement: how many people have acknowledged the current version, how many are pending, pending counts per department and (for one document) the names of people still pending. Use it for "who has not acknowledged the Code of Conduct".',
    parameters: { type: 'object', properties: { document: { type: 'string', description: 'Optional title or code to look at one document, which also lists names.' } }, additionalProperties: false },
  },
];

export interface DocumentWho { perms?: string[] | null; isCompanyAdmin?: boolean }
export const canReviewDocuments = (w: DocumentWho) => !!w.isCompanyAdmin || hasAnyPerm(w.perms, ['doc.create', 'doc.review', 'doc.publish']);
export const canSeeAllDrafts = (w: DocumentWho) => !!w.isCompanyAdmin || hasAnyPerm(w.perms, ['doc.review', 'doc.publish']);
export const canSeeCompliance = (w: DocumentWho) => !!w.isCompanyAdmin || hasAnyPerm(w.perms, ['compliance.view', 'doc.publish']);
export const mayUseDocumentTool = (w: DocumentWho, t: Pick<DocumentAgentTool, 'access'>) =>
  t.access === 'all' || (t.access === 'review' ? canReviewDocuments(w) : canSeeCompliance(w));
export const documentToolsFor = (w: DocumentWho): DocumentAgentTool[] => DOCUMENT_AGENT_TOOLS.filter((t) => mayUseDocumentTool(w, t));

export function documentRoleLine(w: DocumentWho): string {
  const parts = ['For documents this person can read published policies and see what they must acknowledge.'];
  if (canReviewDocuments(w)) parts.push(canSeeAllDrafts(w) ? 'They can see the review queue and document health.' : 'They can see their own documents waiting for review, and document health.');
  if (canSeeCompliance(w)) parts.push('They can see who has and has not acknowledged.');
  return parts.join(' ');
}

/** Rules the model must follow whenever it talks about documents. Added to the system prompt. */
export const DOCUMENT_RULES = [
  '- Documents: answer policy questions only from published text the tools return, and name the document and version. If the text does not cover the question, say so; do not guess, and do not give legal advice. You cannot acknowledge, approve, publish, reject or send reminders: acknowledging is done by the person on the Home page, and the rest on the Documents screens. Never describe the content of a draft or a document in review.',
].join('\n');

// ------------------------------------------------------------------ rows as the data layer returns them (only the fields used)

export interface DocMaster {
  id: string; documentId?: string; title?: string; category?: string; active?: boolean; acknowledgementRequired?: boolean;
  departmentName?: string; confidentiality?: string;
}
export interface DocVersion {
  id: string; documentMasterId?: string; documentId?: string; documentTitle?: string; versionNumber?: string; status?: string;
  createdById?: string; createdByName?: string; createdAt?: string; publishedAt?: string; effectiveFrom?: string; effectiveTo?: string;
  reviewDueDate?: string; previousVersionId?: string; changeSummary?: string;
}
export interface DocAck {
  documentId?: string; versionNumber?: string; documentVersionId?: string; employeeId?: string; employeeName?: string; employeeEmail?: string;
  departmentName?: string; status?: string;
}

export const dayOf = (v: unknown) => String(v || '').slice(0, 10);
const titleOf = (v: DocVersion, m?: DocMaster) => cleanText(v.documentTitle || m?.title || 'Document', 100);

/** The best match for what the person typed: a code first, then an exact title, then a title that contains it. */
export function findDocument<T extends { documentId?: string; title?: string; documentTitle?: string }>(list: T[], query: unknown): T | null {
  const q = cleanText(query, 120).toLowerCase();
  if (!q) return null;
  const t = (x: T) => String(x.title || x.documentTitle || '').toLowerCase();
  return list.find((x) => String(x.documentId || '').toLowerCase() === q)
    || list.find((x) => t(x) === q)
    || list.find((x) => t(x).includes(q))
    || list.find((x) => !!t(x) && q.includes(t(x)))
    || null;
}

// ------------------------------------------------------------------ what changed between two versions

const pieces = (text: string) => String(text || '').split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2);
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function diffText(oldText: string, newText: string, cap = 12, width = 240) {
  const a = pieces(oldText); const b = pieces(newText);
  const inA = new Set(a.map(key)); const inB = new Set(b.map(key));
  const added = b.filter((s) => !inA.has(key(s)));
  const removed = a.filter((s) => !inB.has(key(s)));
  const same = b.length - added.length;
  const total = Math.max(a.length, b.length) || 1;
  return {
    added: added.slice(0, cap).map((s) => cleanText(s, width)), addedCount: added.length,
    removed: removed.slice(0, cap).map((s) => cleanText(s, width)), removedCount: removed.length,
    unchangedPercent: Math.round((same / total) * 100),
    cut: added.length > cap || removed.length > cap,
  };
}

export function summarizeChanges(current: DocVersion, previous: DocVersion | null, diff: ReturnType<typeof diffText> | null) {
  return {
    document: titleOf(current), documentCode: cleanText(current.documentId, 40),
    currentVersion: cleanText(current.versionNumber, 20), effectiveFrom: dayOf(current.effectiveFrom || current.publishedAt),
    authorSummary: cleanText(current.changeSummary, 600) || undefined,
    previousVersion: previous ? cleanText(previous.versionNumber, 20) : undefined,
    ...(diff
      ? { changes: { added: diff.added, removed: diff.removed, addedCount: diff.addedCount, removedCount: diff.removedCount, unchangedPercent: diff.unchangedPercent },
        note: diff.cut ? 'Only the first passages are listed; more changed.' : undefined }
      : { note: previous ? 'The earlier version has no readable text to compare.' : 'This is the first published version, so there is nothing earlier to compare with.' }),
  };
}

// ------------------------------------------------------------------ review queue and document health

export const DUE_SOON_DAYS = 30;

export function summarizeReviewQueue(versions: DocVersion[], today: string, who: DocumentWho & { uid?: string }, cap = 15) {
  const mine = canSeeAllDrafts(who) ? versions : versions.filter((v) => v.createdById && v.createdById === who.uid);
  const row = (v: DocVersion) => ({
    document: titleOf(v), documentCode: cleanText(v.documentId, 40), version: cleanText(v.versionNumber, 20),
    createdBy: cleanText(v.createdByName, 60), createdDaysAgo: v.createdAt ? Math.max(0, daysBetween(dayOf(v.createdAt), today)) : null,
  });
  const byAge = (a: ReturnType<typeof row>, b: ReturnType<typeof row>) => (b.createdDaysAgo ?? 0) - (a.createdDaysAgo ?? 0) || a.document.localeCompare(b.document);
  const waiting = mine.filter((v) => v.status === 'IN_REVIEW').map(row).sort(byAge);
  const sentBack = mine.filter((v) => v.status === 'REVISION_REQUIRED').map(row).sort(byAge);
  return {
    waitingForReview: waiting.length, items: waiting.slice(0, cap),
    sentBackForRevision: sentBack.length, sentBack: sentBack.slice(0, cap),
    scope: canSeeAllDrafts(who) ? 'all documents' : 'documents you created',
    note: 'The age is counted from when the version was created, since the screens do not record when it was submitted.',
  };
}

export function summarizeHealth(published: { v: DocVersion; m?: DocMaster }[], today: string, cap = 15) {
  const soon = addDays(today, DUE_SOON_DAYS);
  const live = published.filter(({ m }) => m?.active !== false);
  const line = (v: DocVersion, m: DocMaster | undefined, date: string) => ({
    document: titleOf(v, m), documentCode: cleanText(v.documentId || m?.documentId, 40), version: cleanText(v.versionNumber, 20), date,
    days: daysBetween(today, date),
  });
  const overdue = live.filter(({ v }) => v.reviewDueDate && dayOf(v.reviewDueDate) < today).map(({ v, m }) => line(v, m, dayOf(v.reviewDueDate))).sort((a, b) => a.days - b.days);
  const dueSoon = live.filter(({ v }) => v.reviewDueDate && dayOf(v.reviewDueDate) >= today && dayOf(v.reviewDueDate) <= soon).map(({ v, m }) => line(v, m, dayOf(v.reviewDueDate))).sort((a, b) => a.days - b.days);
  const expired = live.filter(({ v }) => v.effectiveTo && dayOf(v.effectiveTo) < today).map(({ v, m }) => line(v, m, dayOf(v.effectiveTo))).sort((a, b) => a.days - b.days);
  const expiring = live.filter(({ v }) => v.effectiveTo && dayOf(v.effectiveTo) >= today && dayOf(v.effectiveTo) <= soon).map(({ v, m }) => line(v, m, dayOf(v.effectiveTo))).sort((a, b) => a.days - b.days);
  return {
    publishedDocuments: live.length,
    reviewOverdue: overdue.length, reviewOverdueList: overdue.slice(0, cap),
    reviewDueWithin30Days: dueSoon.length, reviewDueSoonList: dueSoon.slice(0, cap),
    expired: expired.length, expiredList: expired.slice(0, cap),
    expiringWithin30Days: expiring.length, expiringList: expiring.slice(0, cap),
    note: 'A negative "days" means the date has passed.',
  };
}

// ------------------------------------------------------------------ acknowledgements

const ackFor = (a: DocAck, v: DocVersion) => (a.documentVersionId ? a.documentVersionId === v.id : String(a.documentId || '') === String(v.documentId || '') && String(a.versionNumber || '') === String(v.versionNumber || ''));

export interface AckLine { document: string; documentCode: string; version: string; required: number; acknowledged: number; pending: number; percent: number; publishedDaysAgo: number | null }

export function ackLines(published: { v: DocVersion; m?: DocMaster }[], acks: DocAck[], today: string) {
  return published.filter(({ m }) => m?.active !== false && m?.acknowledgementRequired === true).map(({ v, m }) => {
    const rows = acks.filter((a) => ackFor(a, v));
    const done = rows.filter((a) => a.status === 'ACKNOWLEDGED').length;
    const line: AckLine = {
      document: titleOf(v, m), documentCode: cleanText(v.documentId || m?.documentId, 40), version: cleanText(v.versionNumber, 20),
      required: rows.length, acknowledged: done, pending: rows.length - done, percent: rows.length ? Math.round((done / rows.length) * 100) : 100,
      publishedDaysAgo: v.publishedAt ? Math.max(0, daysBetween(dayOf(v.publishedAt), today)) : null,
    };
    return { line, rows };
  });
}

export function summarizeAcknowledgements(published: { v: DocVersion; m?: DocMaster }[], acks: DocAck[], today: string, query?: string, maxNames = 15) {
  const all = ackLines(published, acks, today);
  const one = query ? findDocument(all.map((x) => ({ ...x, title: x.line.document, documentId: x.line.documentCode })), query) : null;
  if (query && !one) return { error: 'No published document needing acknowledgement matches that name.' };
  if (one) {
    const pending = one.rows.filter((a) => a.status !== 'ACKNOWLEDGED');
    const byDept: Record<string, number> = {};
    for (const a of pending) { const d = cleanText(a.departmentName, 60) || 'No department'; byDept[d] = (byDept[d] || 0) + 1; }
    return {
      ...one.line, pendingByDepartment: byDept,
      pendingPeople: pending.slice(0, maxNames).map((a) => cleanText(a.employeeName || a.employeeEmail, 80)), morePending: Math.max(0, pending.length - maxNames),
    };
  }
  return { documents: all.map((x) => x.line).sort((a, b) => a.percent - b.percent || b.pending - a.pending).slice(0, 25), documentsNeedingAcknowledgement: all.length };
}

// ------------------------------------------------------------------ the daily watcher

export const WATCH_DOC_REVIEW_WAIT_DAYS = 3;
export const WATCH_DOC_ACK_DAYS = 7;
export const WATCH_DOC_LOW_PERCENT = 80;

export interface DocumentWatch {
  /** Versions in review for longer than the wait. */
  reviewWaiting: { document: string; version: string; days: number }[];
  /** Published documents whose review date is past or within 30 days (days < 0 means overdue). */
  reviewDue: { document: string; version: string; days: number }[];
  /** Documents a week or more after publishing with fewer than 80% acknowledged. */
  lowAcknowledged: { document: string; version: string; percent: number; pending: number }[];
  /** People who have had a policy to acknowledge for a week or more. */
  pendingAcks: { uid: string; document: string; version: string; days: number }[];
}

export function documentWatch(
  versions: DocVersion[], published: { v: DocVersion; m?: DocMaster }[], acks: DocAck[], who: { uid: string; email: string }[], today: string,
): DocumentWatch {
  const reviewWaiting = versions.filter((v) => v.status === 'IN_REVIEW' && v.createdAt && daysBetween(dayOf(v.createdAt), today) >= WATCH_DOC_REVIEW_WAIT_DAYS)
    .map((v) => ({ document: titleOf(v), version: cleanText(v.versionNumber, 20), days: daysBetween(dayOf(v.createdAt), today) })).sort((a, b) => b.days - a.days);
  const h = summarizeHealth(published, today, 100);
  const reviewDue = [...h.reviewOverdueList, ...h.reviewDueSoonList].map((x) => ({ document: x.document, version: x.version, days: x.days }));
  const lines = ackLines(published, acks, today);
  const lowAcknowledged = lines.map((x) => x.line).filter((l) => l.required > 0 && l.percent < WATCH_DOC_LOW_PERCENT && (l.publishedDaysAgo ?? 0) >= WATCH_DOC_ACK_DAYS)
    .map((l) => ({ document: l.document, version: l.version, percent: l.percent, pending: l.pending }));
  const byEmail = new Map(who.map((p) => [p.email.toLowerCase(), p.uid]));
  const uids = new Set(who.map((p) => p.uid));
  const pendingAcks: DocumentWatch['pendingAcks'] = [];
  for (const { line, rows } of lines) {
    if ((line.publishedDaysAgo ?? 0) < WATCH_DOC_ACK_DAYS) continue;
    for (const a of rows) {
      if (a.status === 'ACKNOWLEDGED') continue;
      const uid = uids.has(String(a.employeeId)) ? String(a.employeeId) : byEmail.get(String(a.employeeEmail || '').toLowerCase());
      if (uid) pendingAcks.push({ uid, document: line.document, version: line.version, days: line.publishedDaysAgo ?? 0 });
    }
  }
  return { reviewWaiting, reviewDue, lowAcknowledged, pendingAcks };
}
