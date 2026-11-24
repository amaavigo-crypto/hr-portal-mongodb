/**
 * Optional wording layer for the leave helpers. It only rephrases an answer the code has already worked out; it
 * never decides anything. With no OPENAI_API_KEY, or if the call fails or changes any number or date, the original
 * wording is returned unchanged. Same env names as the other AI features: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_LEAVE_MODEL.
 */
import { aiEnabled, aiText } from './ai/index.js';

const wordingOff = () => (process.env.LEAVE_AI_WORDING || '').trim().toLowerCase() === 'off';

export const aiWordingOn = () => aiEnabled() && !wordingOff();

const facts = (s: string) => (s.match(/\d+(?:[.\-/]\d+)*/g) || []).sort().join('|');

export async function polishWording(text: string, cid = ''): Promise<{ text: string; ai: boolean }> {
  if (!aiWordingOn() || !text || !cid) return { text, ai: false };
  const res = await aiText({
    cid, feature: 'leave.wording', temperature: 0, maxTokens: 300, timeoutMs: 15000, budgetMs: 18000,
    system: 'Rewrite the text in clear, friendly plain English for an employee. Keep every number, date and rule exactly as given. Add nothing. Do not give advice or make decisions. Reply with the rewritten text only.',
    user: text,
  });
  const out = (res.text || '').trim();
  // Anything that changes a figure or a date is thrown away.
  if (!out || out.length > text.length * 3 + 80 || facts(out) !== facts(text)) return { text, ai: false };
  return { text: out, ai: true };
}
