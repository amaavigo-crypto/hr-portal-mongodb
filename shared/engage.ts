/**
 * Surveys and the social wall: rules and aggregation. Pure functions, no database.
 *
 * Anonymous surveys: a response carries no employee id, only an answer set under an opaque key (see engageApi). Results of an
 * anonymous survey are hidden until MIN_ANON people have answered, and free-text answers are shown in a shuffled order without
 * times, so a lone answer cannot be traced to its author by timing or position.
 */
export const MIN_ANON = 5;
export const MAX_QUESTIONS = 40;
export const MAX_OPTIONS = 12;
export const QUESTION_TYPES = ['RATING', 'NPS', 'CHOICE', 'MULTI', 'TEXT'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface Question { id: string; type: QuestionType; text: string; required: boolean; options?: string[] }
export interface SurveyLike { questions: Question[] }
export type Answers = Record<string, string | number | string[]>;

export function cleanQuestions(input: unknown): { questions: Question[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) return { questions: [], error: 'Add at least one question.' };
  if (input.length > MAX_QUESTIONS) return { questions: [], error: `At most ${MAX_QUESTIONS} questions.` };
  const out: Question[] = [];
  for (let i = 0; i < input.length; i++) {
    const q: any = input[i];
    const type = QUESTION_TYPES.includes(q?.type) ? (q.type as QuestionType) : null;
    const text = String(q?.text ?? '').trim().slice(0, 300);
    if (!type) return { questions: [], error: `Question ${i + 1}: choose a type.` };
    if (!text) return { questions: [], error: `Question ${i + 1}: write the question.` };
    const item: Question = { id: `q${i + 1}`, type, text, required: q?.required !== false };
    if (type === 'CHOICE' || type === 'MULTI') {
      const options = Array.from(new Set((Array.isArray(q?.options) ? q.options : []).map((o: any) => String(o).trim().slice(0, 120)).filter(Boolean))) as string[];
      if (options.length < 2) return { questions: [], error: `Question ${i + 1}: give at least two options.` };
      if (options.length > MAX_OPTIONS) return { questions: [], error: `Question ${i + 1}: at most ${MAX_OPTIONS} options.` };
      item.options = options;
    }
    out.push(item);
  }
  return { questions: out };
}

/** Checks one person's answers against the survey. Returns the cleaned answers or an error. */
export function validateAnswers(s: SurveyLike, raw: unknown): { answers: Answers; error?: string } {
  const given: any = raw && typeof raw === 'object' ? raw : {};
  const answers: Answers = {};
  for (const q of s.questions) {
    const v = given[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) { if (q.required) return { answers, error: `Please answer: ${q.text}` }; continue; }
    if (q.type === 'RATING' || q.type === 'NPS') {
      const n = Number(v), lo = q.type === 'RATING' ? 1 : 0, hi = q.type === 'RATING' ? 5 : 10;
      if (!Number.isInteger(n) || n < lo || n > hi) return { answers, error: `Answer "${q.text}" with a whole number from ${lo} to ${hi}.` };
      answers[q.id] = n;
    } else if (q.type === 'CHOICE') {
      if (typeof v !== 'string' || !q.options!.includes(v)) return { answers, error: `Choose one of the options for: ${q.text}` };
      answers[q.id] = v;
    } else if (q.type === 'MULTI') {
      const arr = Array.isArray(v) ? v.map(String) : [];
      if (arr.some((x) => !q.options!.includes(x))) return { answers, error: `Choose from the options for: ${q.text}` };
      answers[q.id] = Array.from(new Set(arr));
    } else {
      const t = String(v).trim().slice(0, 2000);
      if (t) answers[q.id] = t; else if (q.required) return { answers, error: `Please answer: ${q.text}` };
    }
  }
  return { answers };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A deterministic shuffle so reloading does not reorder text answers, while order never follows submission time. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function aggregate(s: SurveyLike, responses: { answers: Answers }[], seed = 'x') {
  return s.questions.map((q) => {
    const vals = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined);
    const base = { id: q.id, type: q.type, text: q.text, answered: vals.length };
    if (q.type === 'RATING') {
      const nums = vals as number[];
      const dist = [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length);
      return { ...base, average: nums.length ? r1(nums.reduce((a, b) => a + b, 0) / nums.length) : null, distribution: dist };
    }
    if (q.type === 'NPS') {
      const nums = vals as number[];
      const promoters = nums.filter((x) => x >= 9).length, detractors = nums.filter((x) => x <= 6).length;
      return { ...base, promoters, passives: nums.length - promoters - detractors, detractors, score: nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null };
    }
    if (q.type === 'CHOICE' || q.type === 'MULTI') {
      const counts = Object.fromEntries(q.options!.map((o) => [o, 0]));
      for (const v of vals) for (const o of Array.isArray(v) ? v : [v]) if (o in counts) counts[o as string]++;
      return { ...base, counts };
    }
    return { ...base, texts: shuffled(vals as string[], seed + q.id) };
  });
}

export const WALL_KINDS = ['POST', 'ANNOUNCEMENT', 'KUDOS'] as const;
export type WallKind = (typeof WALL_KINDS)[number];
export const REACTIONS = ['LIKE', 'CELEBRATE', 'INSIGHT'] as const;
export const MAX_POST = 2000;
export const MAX_COMMENT = 500;
export const MAX_POSTS_PER_DAY = 20;
export const MAX_COMMENTS_PER_DAY = 60;
