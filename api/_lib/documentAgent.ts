/**
 * Document Version Control tool pack for the Ask HR agent. Registry, rules and counting: shared/documentAgentTools.ts.
 *
 * Read only. The document module has no server routes of its own (its screens use the generic data layer), so two tools reuse the
 * Home routes that already filter by person (`files`, `acks`) and the three manager tools read the collections here, after checking
 * company and permission again. Version text is read only for policies the person may open (published, via Home `files`);
 * the manager tools never select the text at all.
 */
import { db, give, route, str, type Run } from './agentKit.js';
import {
  DOCUMENT_AGENT_TOOLS, canSeeAllDrafts, diffText, findDocument, mayUseDocumentTool, summarizeAcknowledgements, summarizeChanges,
  summarizeHealth, summarizeReviewQueue, type DocAck, type DocMaster, type DocVersion,
} from '../../shared/documentAgentTools.js';
import { istDay } from './agentKit.js';

const slim = (q: any, ...fields: string[]) => (typeof q.select === 'function' ? q.select(...fields) : q);
const VERSION_FIELDS = [
  'documentMasterId', 'documentId', 'documentTitle', 'versionNumber', 'status', 'createdById', 'createdByName', 'createdAt', 'publishedAt',
  'effectiveFrom', 'effectiveTo', 'reviewDueDate', 'previousVersionId', 'changeSummary',
];

/** All versions of the company, without their text. Also used by the daily watcher. */
export async function loadDocumentData(cid: string) {
  const [vs, ds, as] = await Promise.all([
    slim(db().collection('versions').where('companyId', '==', cid), ...VERSION_FIELDS).get(),
    db().collection('documents').where('companyId', '==', cid).get(),
    db().collection('acknowledgments').where('companyId', '==', cid).get(),
  ]);
  const versions: DocVersion[] = vs.docs.map((d: any) => { const { rawContent: _t, ...rest } = d.data() as any; return { ...rest, id: d.id } as DocVersion; });
  const masters = new Map<string, DocMaster>(ds.docs.map((d: any) => [d.id, { ...(d.data() as any), id: d.id } as DocMaster]));
  const acks: DocAck[] = as.docs.map((d: any) => d.data() as DocAck);
  const published = versions.filter((v) => v.status === 'PUBLISHED').map((v) => ({ v, m: masters.get(String(v.documentMasterId)) }));
  return { versions, masters, acks, published };
}

async function versionWithText(cid: string, id: string): Promise<(DocVersion & { rawContent?: string }) | null> {
  if (!id) return null;
  const s = await db().collection('versions').doc(id).get();
  const d: any = s.exists ? s.data() : null;
  // Defence in depth: never read another company's version.
  return d && d.companyId === cid ? ({ ...d, id: s.id } as any) : null;
}

/** Returns the tool result for a document tool, or null when `name` is not one of them. */
export async function runDocumentAgentTool(r: Run, name: string, args: any): Promise<string | null> {
  const def = DOCUMENT_AGENT_TOOLS.find((t) => t.name === name);
  if (!def) return null;
  if (!mayUseDocumentTool(r.ctx, def)) return give(r, name, null, { error: 'Not available for your role.' });
  switch (name) {
    case 'get_my_acknowledgements': {
      const j = await route(r, 'home', 'GET', 'acks');
      if (j.error) return give(r, name, null, j);
      if (j.allowed === false) return give(r, name, null, { error: 'Acknowledgements are not turned on for this person.' });
      return give(r, name, { kind: 'data', label: 'Your acknowledgements' }, {
        pendingCount: j.active?.count ?? 0, pending: j.active?.items ?? [], acknowledgedCount: j.completed?.count ?? 0, acknowledged: j.completed?.items ?? [],
        note: 'The person acknowledges on the Home page.',
      });
    }
    case 'get_policy_changes': {
      const files = await route(r, 'home', 'GET', 'files', undefined, { tab: 'org' });
      if (files.error) return give(r, name, null, files);
      const hit = findDocument<any>(Array.isArray(files.items) ? files.items : [], args?.document);
      if (!hit) return give(r, name, null, { error: 'No published document this person may read matches that name.' });
      const cur = await versionWithText(r.cid, str(hit.id, 200));
      if (!cur || cur.status !== 'PUBLISHED') return give(r, name, null, { error: 'That document is not available.' });
      let prev = cur.previousVersionId ? await versionWithText(r.cid, str(cur.previousVersionId, 200)) : null;
      if (prev && String(prev.documentMasterId) !== String(cur.documentMasterId)) prev = null;
      if (!prev) {
        const snap = await db().collection('versions').where('companyId', '==', r.cid).where('documentMasterId', '==', cur.documentMasterId).where('status', '==', 'SUPERSEDED').get();
        const olds = snap.docs.map((d: any) => ({ ...(d.data() as any), id: d.id })).sort((a: any, b: any) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
        prev = olds[0] || null;
      }
      const diff = prev && prev.rawContent && cur.rawContent ? diffText(prev.rawContent, cur.rawContent) : null;
      const label = `${str(cur.documentTitle, 100)} v${str(cur.versionNumber, 20)}`;
      return give(r, name, { kind: 'policy', label }, summarizeChanges(cur, prev, diff));
    }
    case 'get_review_queue': {
      const { versions } = await loadDocumentData(r.cid);
      return give(r, name, { kind: 'data', label: 'Document review queue' }, summarizeReviewQueue(versions, istDay(), { perms: r.ctx.perms, isCompanyAdmin: r.ctx.isCompanyAdmin, uid: r.ctx.uid }));
    }
    case 'get_document_health': {
      const { published } = await loadDocumentData(r.cid);
      return give(r, name, { kind: 'data', label: 'Document health' }, summarizeHealth(published, istDay()));
    }
    case 'get_acknowledgement_status': {
      const { published, acks } = await loadDocumentData(r.cid);
      const out = summarizeAcknowledgements(published, acks, istDay(), str(args?.document, 120) || undefined);
      return give(r, name, { kind: 'data', label: 'Acknowledgement status' }, out);
    }
    default: return null;
  }
}

export { canSeeAllDrafts };
