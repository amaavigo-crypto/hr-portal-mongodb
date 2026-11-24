/**
 * A tiny schema checker for AI replies (no dependency). The AI is asked for JSON; this decides whether the JSON has
 * the shape the code expects and returns a cleaned copy: unknown keys dropped, text trimmed and shortened, lists
 * shortened. It fails only when something required is missing or has the wrong type, so a slightly chatty reply is
 * still usable while a reply with the wrong structure is never trusted.
 */
export type Schema =
  | { k: 'str'; max: number; opt: boolean; def?: string }
  | { k: 'num'; min: number; max: number; opt: boolean; def?: number }
  | { k: 'bool'; opt: boolean; def?: boolean }
  | { k: 'enum'; values: string[]; opt: boolean; def?: string }
  | { k: 'arr'; item: Schema; max: number; opt: boolean }
  | { k: 'obj'; shape: Record<string, Schema>; opt: boolean }
  | { k: 'any'; opt: boolean };

const opt = <T extends Schema>(s: T): T => ({ ...s, opt: true });

export const s = {
  str: (max = 500): Schema => ({ k: 'str', max, opt: false }),
  num: (min = -Infinity, max = Infinity): Schema => ({ k: 'num', min, max, opt: false }),
  bool: (): Schema => ({ k: 'bool', opt: false }),
  oneOf: (values: string[]): Schema => ({ k: 'enum', values, opt: false }),
  arr: (item: Schema, max = 50): Schema => ({ k: 'arr', item, max, opt: false }),
  obj: (shape: Record<string, Schema>): Schema => ({ k: 'obj', shape, opt: false }),
  any: (): Schema => ({ k: 'any', opt: false }),
  /** Mark a field as allowed to be missing (it then gets `def`, or is left out). */
  optional: <T extends Schema>(x: T, def?: any): T => ({ ...opt(x), def } as T),
};

export type Checked = { ok: true; value: any } | { ok: false; error: string };

function check(sc: Schema, v: any, path: string): Checked {
  if (v === undefined || v === null) {
    if (sc.opt) return { ok: true, value: 'def' in sc ? (sc as any).def : undefined };
    return { ok: false, error: `${path || 'reply'} is missing` };
  }
  switch (sc.k) {
    case 'any':
      return { ok: true, value: v };
    case 'str': {
      if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: `${path} must be text` };
      return { ok: true, value: String(v).trim().slice(0, sc.max) };
    }
    case 'num': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: `${path} must be a number` };
      return { ok: true, value: Math.min(sc.max, Math.max(sc.min, n)) };
    }
    case 'bool': {
      if (typeof v === 'boolean') return { ok: true, value: v };
      if (v === 'true' || v === 'false') return { ok: true, value: v === 'true' };
      return { ok: false, error: `${path} must be true or false` };
    }
    case 'enum': {
      const t = String(v).trim();
      const hit = sc.values.find((x) => x.toLowerCase() === t.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `${path} must be one of ${sc.values.join(', ')}` };
    }
    case 'arr': {
      if (!Array.isArray(v)) return { ok: false, error: `${path} must be a list` };
      const out: any[] = [];
      for (let i = 0; i < Math.min(v.length, sc.max); i++) {
        const r = check(sc.item, v[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case 'obj': {
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `${path || 'reply'} must be an object` };
      const out: Record<string, any> = {};
      for (const [key, sub] of Object.entries(sc.shape)) {
        const r = check(sub, (v as any)[key], path ? `${path}.${key}` : key);
        if (!r.ok) return r;
        if (r.value !== undefined) out[key] = r.value;
      }
      return { ok: true, value: out };
    }
  }
}

export function validate(schema: Schema, value: unknown): Checked {
  return check(schema, value, '');
}
