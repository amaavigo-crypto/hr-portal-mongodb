/**
 * Published HR document vector index.
 *
 * Uses the repository's existing MongoDB connection. Chunks are tenant-scoped and are activated
 * only after every embedding for a published version has been generated and stored.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { isMongoConfigured, nativeMongoDb } from './mongoFirestore.js';

const COLLECTION = 'hrDocumentChunks';
const INDEX_NAME = process.env.HR_VECTOR_INDEX_NAME || 'hr_document_vector_index';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
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
  fileUrl?: string;
  originalFileUrl?: string;
  fileName?: string;
  mimeType?: string;
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

function decodeDataUrl(value: string): Uint8Array {
  const comma = value.indexOf(',');
  if (comma < 0) throw new Error('Uploaded document data URL is malformed.');
  const metadata = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  return metadata.includes(';base64')
    ? new Uint8Array(Buffer.from(payload, 'base64'))
    : new Uint8Array(Buffer.from(decodeURIComponent(payload), 'utf8'));
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX document.xml was not found.');
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, ' ')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => typeof item.str === 'string' ? item.str : '').filter(Boolean).join(' ');
    if (text.trim()) pages.push(text.trim());
  }
  const text = pages.join('\n\n');
  if (!text.trim()) throw new Error('This PDF has no extractable text. Scanned PDFs need OCR before indexing.');
  return text;
}

/** Prefer the already extracted text saved by the existing upload flow; extract data URLs when rawContent is binary. */
async function publishedText(version: PublishedVersion): Promise<string> {
  const raw = String(version.rawContent || version.content || '').trim();
  const file = [version.originalFileUrl, version.fileUrl].find((v) => typeof v === 'string' && v.startsWith('data:')) || '';
  const source = raw.startsWith('data:') ? raw : raw.startsWith('%PDF') ? raw : (!raw ? file : '');
  if (!source) return cleanText(raw);
  const dataUrl = source.startsWith('data:') ? source : '';
  const mime = (dataUrl ? dataUrl.slice(5, dataUrl.indexOf(';') > -1 ? dataUrl.indexOf(';') : dataUrl.indexOf(',')) : version.mimeType || 'application/pdf').toLowerCase();
  const bytes = dataUrl ? decodeDataUrl(dataUrl) : new Uint8Array(Buffer.from(source, 'binary'));
  if (mime.includes('pdf') || source.startsWith('%PDF') || version.fileName?.toLowerCase().endsWith('.pdf')) return cleanText(await extractPdf(bytes));
  if (mime.includes('wordprocessingml') || version.fileName?.toLowerCase().endsWith('.docx')) return cleanText(await extractDocx(bytes));
  if (mime.startsWith('text/')) return cleanText(Buffer.from(bytes).toString('utf8'));
  throw new Error(`Unsupported uploaded document type for extraction: ${mime || version.fileName || 'unknown'}`);
}

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

async function embed(text: string): Promise<number[]> {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key || key === 'MY_OPENAI_API_KEY') throw new Error('OPENAI_API_KEY is not configured.');

  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: DIMENSIONS,
        encoding_format: 'float',
      }),
    });
    const raw = await response.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* handled below */ }
    if (!response.ok) {
      throw new Error(`OpenAI embeddings error (HTTP ${response.status}): ${body?.error?.message || raw.slice(0, 180)}`);
    }
    const values = body?.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length !== DIMENSIONS || values.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new Error('OpenAI returned an invalid embedding vector.');
    }
    return values as number[];
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('OpenAI embedding request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  const body = await publishedText(version);
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
    const vector = await embed(chunks[i]);
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
  await col.updateMany({
    companyId: version.companyId,
    documentMasterId: masterId,
    active: true,
    $or: [{ versionId: { $ne: version.id } }, { contentHash: { $ne: contentHash } }],
  }, { $set: { active: false, supersededAt: new Date() } });
  return { indexed: rows.length, skipped: false };
}

/** Vector retrieval is always filtered by company and active published version. */
export async function searchPublishedPolicies(companyId: string, query: string, limit = 4): Promise<RetrievedPolicyPassage[]> {
  const q = cleanText(query).slice(0, 1500);
  if (!companyId || !q) return [];
  const col = await mongoCollection();
  const vector = await embed(q);
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
