/**
 * The one place that knows how to talk to an AI provider. Today it speaks the OpenAI "chat completions" format, which
 * OpenAI itself and many compatible services use (set OPENAI_BASE_URL to point at one). To move to a different
 * provider, add an adapter next to `complete()` and select it with AI_PROVIDER; nothing else in the app changes.
 *
 * Env: AI_PROVIDER (default "openai"), OPENAI_API_KEY, OPENAI_BASE_URL, AI_MODEL (default "gpt-4o-mini"),
 *      AI_MODEL_<FEATURE> to give one feature its own model (for example AI_MODEL_SCORING=gpt-4o).
 *      The older per-feature names (OPENAI_HIRING_MODEL, OPENAI_SCORING_MODEL, OPENAI_JD_MODEL, OPENAI_LEAVE_MODEL,
 *      OPENAI_ASSISTANT_MODEL, OPENAI_MODEL) still work.
 */
export const providerName = (): string => (process.env.AI_PROVIDER || 'openai').trim().toLowerCase();

export const aiKey = (): string => {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' ? '' : k;
};
export const aiEnabled = (): boolean => !!aiKey();

const LEGACY_MODEL_ENV: Record<string, string> = {
  scoring: 'OPENAI_SCORING_MODEL',
  jd: 'OPENAI_JD_MODEL',
  leave: 'OPENAI_LEAVE_MODEL',
  assistant: 'OPENAI_ASSISTANT_MODEL',
  agent: 'OPENAI_AGENT_MODEL',
};

/** Which model a feature uses. Feature names look like "scoring" or "hiring.resume"; the group is the part before the dot. */
export function modelFor(feature: string): string {
  const f = String(feature || '').toLowerCase();
  const group = f.split('.')[0];
  const key = f.replace(/[^a-z0-9]+/g, '_').toUpperCase();
  const pick = [
    process.env[`AI_MODEL_${key}`],
    process.env[`AI_MODEL_${group.toUpperCase()}`],
    process.env[LEGACY_MODEL_ENV[group] || 'OPENAI_HIRING_MODEL'],
    process.env.AI_MODEL,
    process.env.OPENAI_MODEL,
  ].find((x) => x && x.trim());
  return (pick || 'gpt-4o-mini').trim();
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface CompleteInput {
  model: string;
  messages: any[];
  json?: boolean;
  tools?: any[];
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}
export interface CompleteOutput { message: any; inputTokens: number; outputTokens: number }

export class AiError extends Error {
  constructor(message: string, public status: number, public retryable: boolean, public retryAfterMs = 0) {
    super(message);
  }
}

export async function complete(i: CompleteInput): Promise<CompleteOutput> {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, i.timeoutMs));
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey()}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: i.model,
        temperature: i.temperature,
        max_tokens: i.maxTokens,
        messages: i.messages,
        ...(i.json ? { response_format: { type: 'json_object' } } : {}),
        ...(i.tools ? { tools: i.tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}),
      }),
    });
    const raw = await res.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* handled below */ }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new AiError(
        `AI service error (HTTP ${res.status}): ${body?.error?.message || raw.slice(0, 150)}`,
        res.status,
        res.status === 429 || res.status >= 500,
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 0
      );
    }
    const message = body?.choices?.[0]?.message;
    if (!message) throw new AiError('The AI service sent an empty answer.', res.status, true);
    return { message, inputTokens: Number(body?.usage?.prompt_tokens) || 0, outputTokens: Number(body?.usage?.completion_tokens) || 0 };
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    if (e?.name === 'AbortError') throw new AiError('The AI took too long to answer. Try again.', 0, false);
    throw new AiError(`AI request failed: ${e?.message || e}`, 0, true);
  } finally {
    clearTimeout(timer);
  }
}
