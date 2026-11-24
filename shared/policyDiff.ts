/**
 * Comparing two versions of a policy, in code. The AI is only given the result and asked to put it in plain words,
 * so the list of what changed never depends on the model.
 */

/** Policy text as plain paragraphs. Handles HTML saved by the editor. */
export function plainText(raw: string): string {
  let t = String(raw || '');
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|table|ul|ol|section)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const paragraphsOf = (raw: string): string[] =>
  plainText(raw).split(/\n{2,}|\n(?=(?:#{1,6}\s|\d+[.)]\s))/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 1);

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) || []));
const similar = (a: string, b: string) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
};

export interface PolicyChange { kind: 'ADDED' | 'REMOVED' | 'CHANGED'; before?: string; after?: string }
export interface PolicyDiff { changes: PolicyChange[]; added: number; removed: number; changed: number }

export function diffPolicy(oldText: string, newText: string): PolicyDiff {
  const oldP = paragraphsOf(oldText), newP = paragraphsOf(newText);
  const left = [...oldP];
  const fresh: string[] = [];
  for (const p of newP) { const i = left.indexOf(p); if (i >= 0) left.splice(i, 1); else fresh.push(p); }
  const changes: PolicyChange[] = [];
  const unmatched = [...left];
  for (const n of fresh) {
    let best = -1, score = 0;
    unmatched.forEach((o, i) => { const s = similar(o, n); if (s > score) { score = s; best = i; } });
    if (best >= 0 && score >= 0.45) { changes.push({ kind: 'CHANGED', before: unmatched[best], after: n }); unmatched.splice(best, 1); }
    else changes.push({ kind: 'ADDED', after: n });
  }
  for (const o of unmatched) changes.push({ kind: 'REMOVED', before: o });
  return {
    changes, added: changes.filter((c) => c.kind === 'ADDED').length, removed: changes.filter((c) => c.kind === 'REMOVED').length, changed: changes.filter((c) => c.kind === 'CHANGED').length,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

/** The changes as text for the AI (and for a plain summary when the AI is off or fails). Long lists are cut so the request stays small. */
export function describeChanges(d: PolicyDiff, budget = 6000): string {
  const out: string[] = [];
  let used = 0;
  for (const c of d.changes) {
    const line = c.kind === 'ADDED' ? `ADDED: ${clip(c.after!, 500)}` : c.kind === 'REMOVED' ? `REMOVED: ${clip(c.before!, 500)}` : `CHANGED FROM: ${clip(c.before!, 400)}\nCHANGED TO: ${clip(c.after!, 400)}`;
    if (used + line.length > budget) { out.push(`(${d.changes.length - out.length} more change(s) not shown)`); break; }
    out.push(line); used += line.length;
  }
  return out.join('\n\n');
}

/** A summary that needs no AI. Used when the AI is off, fails, or writes a number the changes do not contain. */
export function basicSummary(d: PolicyDiff): string {
  if (!d.changes.length) return 'No wording changes.';
  const bits = [d.added && `${d.added} new paragraph${d.added > 1 ? 's' : ''}`, d.changed && `${d.changed} paragraph${d.changed > 1 ? 's' : ''} reworded`, d.removed && `${d.removed} paragraph${d.removed > 1 ? 's' : ''} removed`].filter(Boolean);
  const first = d.changes[0];
  const peek = clip(first.after || first.before || '', 90);
  return `${bits.join(', ')}. For example: "${peek}"`;
}
