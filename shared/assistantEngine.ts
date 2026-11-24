/**
 * Ask HR assistant: the parts that need no database or network, so they can be tested on their own.
 *
 *  - splitting policy text into passages and finding the passages that match a question (plain keyword scoring)
 *  - checking that an answer only uses numbers that came from the person's own data or the policy passages
 *  - keeping the chat history short and clean before it is sent to the model
 */

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'i', 'my', 'me', 'we', 'our', 'you', 'your', 'to', 'of', 'in', 'on', 'at', 'for',
  'and', 'or', 'it', 'this', 'that', 'with', 'what', 'when', 'how', 'many', 'much', 'can', 'will', 'would', 'should', 'there', 'any', 'have', 'has', 'get', 'about', 'from', 'as', 'by',
]);

export const tokens = (s: string): string[] =>
  ((String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []) as string[]).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));

/** Splits text into passages of roughly `size` characters, keeping paragraphs together where it can. */
/** With merge off, each paragraph stays its own passage (used when passages are quoted back word for word). */
export function chunkText(text: string, size = 900, merge = true): string[] {
  const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}|\n(?=[#\d]+[.)]?\s)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > size * 1.5) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    if (cur && (!merge || cur.length + p.length + 1 > size)) { out.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

export interface PolicyDoc { id: string; title: string; version: string; text: string }
export interface Passage { docId: string; title: string; version: string; text: string; score: number }

/** The best matching passages for a question, best first. Title words count extra so "leave policy" finds the Leave Policy. */
export function rankPassages(query: string, docs: PolicyDoc[], k = 4, size = 900, merge = true): Passage[] {
  const q = Array.from(new Set(tokens(query)));
  if (q.length === 0) return [];
  const all: { doc: PolicyDoc; text: string; tk: string[] }[] = [];
  for (const d of docs) for (const c of chunkText(d.text, size, merge)) all.push({ doc: d, text: c, tk: tokens(c) });
  if (all.length === 0) return [];
  const df = new Map<string, number>();
  for (const a of all) for (const t of new Set(a.tk)) df.set(t, (df.get(t) || 0) + 1);
  const scored: Passage[] = [];
  for (const a of all) {
    const titleTk = new Set(tokens(a.doc.title));
    const counts = new Map<string, number>();
    for (const t of a.tk) counts.set(t, (counts.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const tf = counts.get(t) || 0;
      const idf = Math.log(1 + all.length / (1 + (df.get(t) || 0)));
      if (tf) score += (1 + Math.log(tf)) * idf;
      if (titleTk.has(t)) score += idf * 0.5;
    }
    if (score > 0) scored.push({ docId: a.doc.id, title: a.doc.title, version: a.doc.version, text: a.text.slice(0, 1200), score: Math.round(score * 100) / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

const numOf = (s: string) => Number(s.replace(/,/g, ''));
export const numbersIn = (s: string): number[] => (String(s || '').match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []).map(numOf).filter((n) => Number.isFinite(n));

/**
 * Numbers in the answer that appear nowhere in the facts or the question. 0 and 1 are always allowed ("no days", "1 day").
 * A non-empty result means the model may have made a number up or worked one out, so the answer should not be shown as it is.
 */
export function unverifiedNumbers(answer: string, facts: string[]): string[] {
  const known = new Set<number>([0, 1]);
  for (const f of facts) for (const n of numbersIn(f)) known.add(n);
  const bad: string[] = [];
  for (const m of String(answer || '').match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []) if (!known.has(numOf(m))) bad.push(m);
  return Array.from(new Set(bad));
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

/** At most the last 6 turns, only user/assistant roles, each cut short. Anything else the browser sends is dropped. */
export function cleanHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .map((t: any) => ({ role: t.role as 'user' | 'assistant', content: String(t.content).trim().slice(0, 600) }))
    .slice(-6);
}

// ------------------------------------------------------------------ quoting the policy exactly

const MARKER = /\s*\[\[quote:([A-Za-z0-9]+)\]\]/g;

/** The answer with the quote markers taken out (used before checking its numbers, so a marker id is never mistaken for a figure). */
export const withoutMarkers = (answer: string) => String(answer || '').replace(MARKER, '');

const norm = (s: string) => String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The model only says WHICH passage supports a sentence ([[quote:P2]]); the words of the quote come from the stored policy text.
 * Markers for passages that were never retrieved are dropped, and anything the model put in quotation marks that is not
 * word for word in a retrieved passage loses its quotation marks, so nothing invented is ever shown as a quote.
 */
export function applyQuotes<T extends { text: string }>(answer: string, byId: Map<string, T>): { answer: string; used: { id: string; passage: T }[] } {
  const used: { id: string; passage: T }[] = [];
  let text = String(answer || '').replace(MARKER, (_m, id: string) => {
    const passage = byId.get(id);
    if (passage && !used.some((u) => u.id === id)) used.push({ id, passage });
    return '';
  });
  const haystack = Array.from(byId.values()).map((p) => norm(p.text));
  text = text.replace(/([\u201c"])([^\u201d"]{25,}?)([\u201d"])/g, (m, _a: string, inner: string) => {
    if (inner.trim().split(/\s+/).length < 5) return m;
    const n = norm(inner).replace(/[.…]+$/, '');
    return haystack.some((h) => h.includes(n)) ? m : inner;
  });
  return { answer: text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim(), used };
}
