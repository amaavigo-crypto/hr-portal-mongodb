/**
 * Published HR document vector index.
 *
 * Uses the repository's existing MongoDB connection. Chunks are tenant-scoped and are activated
 * only after every embedding for a published version has been generated and stored.
 */
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { isMongoConfigured, nativeMongoDb } from './mongoFirestore.js';

const COLLECTION = 'hrDocumentChunks';
const INDEX_NAME = process.env.HR_VECTOR_INDEX_NAME || 'hr_document_vector_index';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const DIMENSIONS = Number(process.env.HR_EMBEDDING_DIMENSIONS || 768);
const CHUNK_CHARS = 3000;
const OVERLAP_CHARS = 400;

type PublishedVersion = {
  id: string;
  companyId: string;
  documentMasterId?: string;
  documentId?: string;
  versionNumber?: string;
  status: string;
  title?: string;
  documentTitle?: string;
  rawContent?: string;
  content?: string;
};

export type RetrievedPolicyPassage = {
  docId: string;
  title: string;
  version: string;
  text: string;
  score: number;
};

const cleanText = (s: string) => String(s || '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const hashText = (s: string) => createHash('sha256').update(s).digest('hex');

function splitText(input: string): string[] {
  const text = cleanText(input);
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current) { chunks.push(current); current = ''; }
      let offset = 0;
      while (offset < paragraph.length) {
        const end = Math.min(offset + CHUNK_CHARS, paragraph.length);
        const piece = paragraph.slice(offset, end).trim();
        if (piece) chunks.push(piece);
        if (end === paragraph.length) break;
        offset = end - OVERLAP_CHARS;
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > CHUNK_CHARS) {
      chunks.push(current);
      current = current.slice(-OVERLAP_CHARS) + '\n' + paragraph;
    } else current = current ? current + '\n\n' + paragraph : paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

let genai: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');
  return (genai ||= new GoogleGenAI({ apiKey: key }));
}

async function embed(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[]> {
  const response = await gemini().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: DIMENSIONS },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values?.length || values.length !== DIMENSIONS || values.some((n) => !Number.isFinite(n))) {
    throw new Error('Gemini returned an invalid embedding vector.');
  }
  // gemini-embedding-001 vectors are normalized here for consistent cosine similarity at reduced dimensions.
  if (EMBEDDING_MODEL === 'gemini-embedding-001') {
    const norm = Math.sqrt(values.reduce((sum, n) => sum + n * n, 0)) || 1;
    return values.map((n) => n / norm);
  }
  return values;
}

function mongoCollection() {
  if (!isMongoConfigured()) throw new Error('MongoDB vector storage requires MONGODB_URI.');
  return nativeMongoDb().then((db) => db.collection(COLLECTION));
}

/**
 * Indexes a published version. A version becomes active only after all chunks are safely written.
 * A content hash makes repeat calls idempotent; a new version supersedes prior versions for its master.
 */
export async function indexPublishedVersion(version: PublishedVersion): Promise<{ indexed: number; skipped: boolean }> {
  if (!version || version.status !== 'PUBLISHED' || !version.companyId || !version.id) return { indexed: 0, skipped: true };
  const body = cleanText(version.rawContent || version.content || '');
  if (!body) return { indexed: 0, skipped: true };
  const contentHash = hashText(body);
  const col = await mongoCollection();
  const masterId = version.documentMasterId || version.documentId || version.id;
  const prior = await col.findOne({ companyId: version.companyId, versionId: version.id, contentHash, active: true }, { projection: { _id: 1 } });
  if (prior) return { indexed: 0, skipped: true };

  const chunks = splitText(body);
  if (!chunks.length) return { indexed: 0, skipped: true };
  const title = String(version.title || version.documentTitle || version.documentId || 'HR document').slice(0, 180);
  const rows: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const vector = await embed(chunks[i], 'RETRIEVAL_DOCUMENT');
    rows.push({
      _id: hashText([version.companyId, version.id, contentHash, String(i)].join('|')),
      companyId: version.companyId,
      documentMasterId: masterId,
      documentId: version.documentId || masterId,
      versionId: version.id,
      versionNumber: String(version.versionNumber || ''),
      title,
      chunkIndex: i,
      text: chunks[i],
      contentHash,
      embedding: vector,
      active: false,
      indexedAt: new Date(),
    });
  }

  // Store inactive first. A failed embedding/write never disables the currently published version.
  await col.bulkWrite(rows.map((row) => ({ replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true } })), { ordered: true });
  // Activate the complete new version first; then retire the previous version. If retirement fails,
  // the assistant's permission-filtered version allow-list still prevents old chunks from being returned.
  await col.updateMany({ companyId: version.companyId, versionId: version.id, contentHash }, { $set: { active: true, activatedAt: new Date() } });
  await col.updateMany({ companyId: version.companyId, documentMasterId: masterId, versionId: { $ne: version.id }, active: true }, { $set: { active: false, supersededAt: new Date() } });
  return { indexed: rows.length, skipped: false };
}

/** Vector retrieval is always filtered by company and active published version. */
export async function searchPublishedPolicies(companyId: string, query: string, limit = 4): Promise<RetrievedPolicyPassage[]> {
  const q = cleanText(query).slice(0, 1500);
  if (!companyId || !q) return [];
  const col = await mongoCollection();
  const vector = await embed(q, 'RETRIEVAL_QUERY');
  const rows = await col.aggregate([
    {
      $vectorSearch: {
        index: INDEX_NAME,
        path: 'embedding',
        queryVector: vector,
        numCandidates: Math.max(40, limit * 12),
        limit,
        filter: { companyId, active: true },
      },
    },
    {
      $project: {
        _id: 0, versionId: 1, title: 1, versionNumber: 1, text: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]).toArray();
  return rows.map((r: any) => ({
    docId: String(r.versionId || ''),
    title: String(r.title || 'HR document'),
    version: String(r.versionNumber || ''),
    text: String(r.text || '').slice(0, 1200),
    score: Number(r.score || 0),
  }));
}

/** Exposed for the admin re-index script and health diagnostics. */
export const documentVectorConfig = {
  collection: COLLECTION,
  indexName: INDEX_NAME,
  embeddingModel: EMBEDDING_MODEL,
  dimensions: DIMENSIONS,
};
