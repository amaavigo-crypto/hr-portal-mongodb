/**
 * Price table used to turn token counts into an estimated cost. Prices are US dollars per 1 million tokens.
 * This is the one place to update when a provider changes its prices or you start using a new model.
 * A model that is not listed is still used normally; its cost is just shown as "not priced" (zero) in usage.
 */
export interface Price { in: number; out: number }

export const PRICES: Record<string, Price> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'gpt-4.1': { in: 2, out: 8 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
};

export function priceOf(model: string): Price | null {
  const m = String(model || '').trim().toLowerCase();
  if (PRICES[m]) return PRICES[m];
  // Dated versions such as "gpt-4o-mini-2024-07-18" use the base model's price.
  const base = Object.keys(PRICES).filter((k) => m.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return base ? PRICES[base] : null;
}

/** Cost in millionths of a US dollar (integer, so sums never drift). */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  if (!p) return 0;
  return Math.round(inputTokens * p.in + outputTokens * p.out);
}
