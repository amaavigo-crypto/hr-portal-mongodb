/**
 * Report builder engine. Pure functions, no database.
 *
 * A report is a dataset, the columns to show, filters, a sort, and optionally "group by one field and count/sum/average".
 * Only fields in the dataset's catalog can be used; anything else in a saved definition is dropped, so a definition can
 * never reach data the catalog does not offer.
 */
export type FieldKind = 'text' | 'number' | 'date' | 'bool';
export interface CatalogField { key: string; label: string; kind: FieldKind }
export const OPS = ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty'] as const;
export type Op = (typeof OPS)[number];
export const AGGS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type Agg = (typeof AGGS)[number];

export interface Filter { field: string; op: Op; value?: string }
export interface ReportDef {
  dataset: string; columns: string[]; filters: Filter[];
  sort?: { field: string; dir: 'asc' | 'desc' };
  group?: { by: string; agg: Agg; field?: string };
}
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 20;
export const MAX_FILTERS = 10;

export function cleanDef(raw: any, catalog: CatalogField[]): { def?: ReportDef; error?: string } {
  const known = new Map(catalog.map((f) => [f.key, f]));
  const columns = (Array.isArray(raw?.columns) ? raw.columns : []).map(String).filter((k: string, i: number, a: string[]) => known.has(k) && a.indexOf(k) === i).slice(0, MAX_COLUMNS);
  const filters: Filter[] = (Array.isArray(raw?.filters) ? raw.filters : []).filter((f: any) => known.has(String(f?.field)) && (OPS as readonly string[]).includes(f?.op)).slice(0, MAX_FILTERS)
    .map((f: any) => ({ field: String(f.field), op: f.op as Op, value: String(f.value ?? '').slice(0, 200) }));
  const out: ReportDef = { dataset: String(raw?.dataset ?? ''), columns, filters };
  if (raw?.sort && known.has(String(raw.sort.field))) out.sort = { field: String(raw.sort.field), dir: raw.sort.dir === 'desc' ? 'desc' : 'asc' };
  if (raw?.group && known.has(String(raw.group.by))) {
    const agg: Agg = (AGGS as readonly string[]).includes(raw.group.agg) ? raw.group.agg : 'count';
    if (agg !== 'count') {
      const f = known.get(String(raw.group.field));
      if (!f || f.kind !== 'number') return { error: `${agg === 'sum' ? 'Sum' : agg === 'avg' ? 'Average' : agg === 'min' ? 'Minimum' : 'Maximum'} needs a number field to add up.` };
      out.group = { by: String(raw.group.by), agg, field: f.key };
    } else out.group = { by: String(raw.group.by), agg };
  }
  if (!out.group && columns.length === 0) return { error: 'Choose at least one column.' };
  return { def: out };
}

const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

export function matches(row: Record<string, any>, f: Filter, kind: FieldKind): boolean {
  const v = row[f.field];
  if (f.op === 'empty') return isEmpty(v);
  if (f.op === 'notempty') return !isEmpty(v);
  if (isEmpty(v)) return f.op === 'neq';
  const want = f.value ?? '';
  if (kind === 'number') {
    const a = num(v), b = num(want);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return f.op === 'eq' ? a === b : f.op === 'neq' ? a !== b : f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : f.op === 'lte' ? a <= b : false;
  }
  if (kind === 'bool') { const a = v === true || v === 'true', b = want === 'true'; return f.op === 'eq' ? a === b : f.op === 'neq' ? a !== b : false; }
  const a = String(v), b = want;
  if (kind === 'date') return f.op === 'eq' ? a === b : f.op === 'neq' ? a !== b : f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : f.op === 'lte' ? a <= b : f.op === 'contains' ? a.includes(b) : false;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  return f.op === 'eq' ? al === bl : f.op === 'neq' ? al !== bl : f.op === 'contains' ? al.includes(bl) : f.op === 'gt' ? al > bl : f.op === 'gte' ? al >= bl : f.op === 'lt' ? al < bl : f.op === 'lte' ? al <= bl : false;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function runReport(def: ReportDef, catalog: CatalogField[], rows: Record<string, any>[]) {
  const kinds = new Map(catalog.map((f) => [f.key, f]));
  let data = rows.filter((row) => def.filters.every((f) => matches(row, f, kinds.get(f.field)!.kind)));
  const total = data.length;
  if (def.group) {
    const by = kinds.get(def.group.by)!, valField = def.group.field ? kinds.get(def.group.field) : undefined;
    const buckets = new Map<string, number[]>();
    for (const row of data) {
      const k = isEmpty(row[def.group.by]) ? '(blank)' : String(row[def.group.by]);
      const arr = buckets.get(k) || [];
      if (def.group.agg === 'count') arr.push(1);
      else { const n = num(row[def.group.field!]); if (!Number.isNaN(n)) arr.push(n); }
      buckets.set(k, arr);
    }
    const label = def.group.agg === 'count' ? 'Count' : `${def.group.agg === 'sum' ? 'Total' : def.group.agg === 'avg' ? 'Average' : def.group.agg === 'min' ? 'Lowest' : 'Highest'} ${valField!.label}`;
    const out = [...buckets.entries()].map(([k, vals]) => ({
      [by.key]: k,
      value: def.group!.agg === 'count' ? vals.length : !vals.length ? null : def.group!.agg === 'sum' ? r2(vals.reduce((a, b) => a + b, 0)) : def.group!.agg === 'avg' ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : def.group!.agg === 'min' ? Math.min(...vals) : Math.max(...vals),
    }));
    const dir = def.sort?.dir === 'asc' ? 1 : -1;
    out.sort((a: any, b: any) => (def.sort?.field === by.key ? dir * -1 * String(a[by.key]).localeCompare(String(b[by.key])) : dir * ((a.value ?? -Infinity) - (b.value ?? -Infinity))) || String(a[by.key]).localeCompare(String(b[by.key])));
    return { columns: [{ key: by.key, label: by.label, kind: by.kind }, { key: 'value', label, kind: 'number' as FieldKind }], rows: out, total, truncated: false };
  }
  if (def.sort) {
    const f = kinds.get(def.sort.field)!, dir = def.sort.dir === 'desc' ? -1 : 1;
    data = [...data].sort((a, b) => {
      const x = a[f.key], y = b[f.key];
      if (isEmpty(x) !== isEmpty(y)) return isEmpty(x) ? 1 : -1;
      return dir * (f.kind === 'number' ? num(x) - num(y) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
    });
  }
  const columns = def.columns.map((k) => kinds.get(k)!);
  const truncated = data.length > MAX_ROWS;
  return { columns, rows: data.slice(0, MAX_ROWS).map((row) => Object.fromEntries(def.columns.map((k) => [k, row[k] ?? null]))), total, truncated };
}
