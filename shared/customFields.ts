/** Custom fields on employee profiles: definitions and value checking. Pure functions, no database. */
export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const MAX_FIELDS = 40;

export interface FieldDef {
  key: string; label: string; type: FieldType; section: string; options?: string[]; required: boolean;
  /** The employee can see this field on their own profile. */
  selfView: boolean;
  /** The employee can fill or change this field themselves (implies selfView). */
  selfEdit: boolean;
}
export type FieldValue = string | number | boolean;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

export function cleanDefs(input: unknown): { defs: FieldDef[]; error?: string } {
  if (!Array.isArray(input)) return { defs: [], error: 'Send the fields as a list.' };
  if (input.length > MAX_FIELDS) return { defs: [], error: `At most ${MAX_FIELDS} fields.` };
  const keys = new Set<string>();
  const defs: FieldDef[] = [];
  for (let i = 0; i < input.length; i++) {
    const f: any = input[i];
    const label = String(f?.label ?? '').trim().slice(0, 60);
    if (!label) return { defs: [], error: `Field ${i + 1}: give it a label.` };
    const type: FieldType | null = FIELD_TYPES.includes(f?.type) ? f.type : null;
    if (!type) return { defs: [], error: `${label}: choose a type.` };
    let key = slug(String(f?.key || label)) || `field_${i + 1}`;
    if (/^\d/.test(key)) key = `f_${key}`;
    const base = key; let n = 2;
    while (keys.has(key)) key = `${base}_${n++}`;
    keys.add(key);
    const def: FieldDef = { key, label, type, section: String(f?.section ?? '').trim().slice(0, 40) || 'Additional details', required: f?.required === true, selfView: f?.selfView === true || f?.selfEdit === true, selfEdit: f?.selfEdit === true };
    if (type === 'SELECT') {
      const options = Array.from(new Set((Array.isArray(f?.options) ? f.options : []).map((o: any) => String(o).trim().slice(0, 80)).filter(Boolean))) as string[];
      if (options.length < 2) return { defs: [], error: `${label}: give at least two options.` };
      def.options = options.slice(0, 30);
    }
    defs.push(def);
  }
  return { defs };
}

/** Cleans a set of values against the definitions. Unknown keys are dropped; an empty value clears the field. */
export function cleanValues(defs: FieldDef[], raw: unknown, only?: (d: FieldDef) => boolean): { values: Record<string, FieldValue | null>; error?: string } {
  const given: any = raw && typeof raw === 'object' ? raw : {};
  const values: Record<string, FieldValue | null> = {};
  for (const d of defs) {
    if (only && !only(d)) continue;
    if (!(d.key in given)) continue;
    const v = given[d.key];
    const empty = v === null || v === undefined || v === '';
    if (empty) { if (d.required) return { values, error: `${d.label} is required.` }; values[d.key] = null; continue; }
    if (d.type === 'NUMBER') { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { values, error: `${d.label} must be a number.` }; values[d.key] = n; }
    else if (d.type === 'BOOLEAN') { if (typeof v !== 'boolean') return { values, error: `${d.label} must be yes or no.` }; values[d.key] = v; }
    else if (d.type === 'DATE') { const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) return { values, error: `${d.label} must be a valid date.` }; values[d.key] = s; }
    else if (d.type === 'SELECT') { const s = String(v); if (!d.options!.includes(s)) return { values, error: `${d.label}: choose one of the options.` }; values[d.key] = s; }
    else values[d.key] = String(v).trim().slice(0, 500);
  }
  return { values };
}

/** Required fields that are still empty after applying `values` on top of what is stored. */
export function missingRequired(defs: FieldDef[], stored: Record<string, FieldValue | null>): string[] {
  return defs.filter((d) => d.required && (stored[d.key] === undefined || stored[d.key] === null || stored[d.key] === '')).map((d) => d.label);
}
