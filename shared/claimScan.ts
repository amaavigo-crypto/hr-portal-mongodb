/**
 * Pure rules for reimbursement claims: checking a GSTIN, tidying what the AI read off a bill, suggesting a category, and
 * raising flags (duplicates, amount or date not matching the bill) for the approver. No browser or Node imports, so the
 * server and the tests share it. The AI only reads the bill; everything that decides or checks lives here.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^(0[1-9]|[12]\d|3[0-8]|9[79])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const normGstin = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);

/** True when the text has the shape of a GSTIN and its last character matches the check digit. */
export function gstinValid(v: unknown): boolean {
  const g = normGstin(v);
  if (!GSTIN_SHAPE.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (iso: string): string => (isDate(iso) ? `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso);
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const addDaysIso = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

export const normVendor = (v: unknown): string => String(v ?? '').toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|co|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export type Confidence = 'high' | 'low';
export interface ScanInfo {
  amount: number | null;
  date: string;
  vendor: string;
  gstin: string;
  gstinValid: boolean;
  category: string;
  /** Fields the AI was unsure about or that failed a check. They are left blank for the person to fill in. */
  unclear: string[];
}

/** Turns the AI's raw reading into safe values. Anything doubtful is blanked, never guessed. */
export function cleanScan(raw: any, o: { today: string; categories: string[] }): ScanInfo {
  const conf = (k: string): Confidence => (raw?.confidence?.[k] === 'low' ? 'low' : 'high');
  const unclear: string[] = [];
  let amount: number | null = null;
  const a = typeof raw?.amount === 'string' ? Number(raw.amount.replace(/[^0-9.]/g, '')) : raw?.amount;
  if (typeof a === 'number' && Number.isFinite(a) && a > 0 && a <= 1_000_000 && conf('amount') === 'high') amount = Math.round(a * 100) / 100;
  else unclear.push('amount');
  let date = String(raw?.date ?? '').trim();
  if (!(isDate(date) && date <= o.today && date >= addDaysIso(o.today, -366) && conf('date') === 'high')) { date = ''; unclear.push('date'); }
  const vendor = conf('vendor') === 'high' ? String(raw?.vendor ?? '').trim().slice(0, 80) : '';
  if (!vendor) unclear.push('vendor');
  let gstin = normGstin(raw?.gstin);
  const valid = !!gstin && gstinValid(gstin);
  if (gstin && (!valid || conf('gstin') === 'low')) { /* keep what was read so the approver sees the problem, but mark it */ if (conf('gstin') === 'low') gstin = ''; }
  if (!gstin) unclear.push('gstin');
  const wanted = String(raw?.category ?? '').trim().toLowerCase();
  const category = o.categories.find((c) => c.toLowerCase() === wanted) || '';
  return { amount, date, vendor, gstin, gstinValid: !!gstin && valid, category, unclear };
}

const KEYWORDS: { words: RegExp; categories: string[] }[] = [
  { words: /hotel|resort|lodge|\binn\b|airline|air india|indigo|irctc|railway|\brail\b|uber|\bola\b|\bcab\b|taxi|flight|travel|\bbus\b|metro/, categories: ['travel', 'hotel', 'lodging', 'stay'] },
  { words: /restaurant|cafe|café|kitchen|biryani|pizza|dhaba|bakery|swiggy|zomato|canteen|\bmess\b|sweets|food|diner/, categories: ['food', 'meal'] },
  { words: /petrol|diesel|\bfuel\b|hpcl|bpcl|iocl|indian oil|filling station|\bshell\b/, categories: ['fuel', 'petrol'] },
  { words: /airtel|\bjio\b|vodafone|bsnl|broadband|recharge|telecom/, categories: ['phone', 'internet'] },
  { words: /pharmacy|chemist|hospital|clinic|apollo|diagnostic|medical/, categories: ['medical'] },
  { words: /stationery|office|staples|printing|xerox|amazon|flipkart/, categories: ['office', 'supplies'] },
];

/** A category from this person's company history first, then from words in the vendor name. Returns '' when nothing fits. */
export function suggestCategory(vendor: string, categories: string[], history: { vendor: string; category: string }[]): { category: string; reason: 'HISTORY' | 'KEYWORD' | '' } {
  const v = normVendor(vendor);
  if (!v) return { category: '', reason: '' };
  const counts = new Map<string, number>();
  for (const h of history) if (normVendor(h.vendor) === v && categories.includes(h.category)) counts.set(h.category, (counts.get(h.category) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return { category: best[0], reason: 'HISTORY' };
  const raw = String(vendor).toLowerCase();
  for (const k of KEYWORDS) {
    if (!k.words.test(raw)) continue;
    const hit = categories.find((c) => k.categories.some((w) => c.toLowerCase().includes(w)));
    if (hit) return { category: hit, reason: 'KEYWORD' };
  }
  return { category: '', reason: '' };
}

export interface ClaimFacts { id?: string; uid: string; amount: number; expenseDate: string; billHash?: string; vendor?: string; status?: string }
export interface Flag { kind: 'DUPLICATE_FILE' | 'DUPLICATE_DETAILS' | 'AMOUNT_MISMATCH' | 'DATE_MISMATCH' | 'GSTIN_INVALID'; text: string; otherId?: string }

const claimNo = (id: string) => `CLM-${String(id).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;

/** Things an approver should look at. They never block a claim; the approver decides. */
export function claimFlags(c: ClaimFacts, scan: Partial<ScanInfo> | null, others: ClaimFacts[]): Flag[] {
  const flags: Flag[] = [];
  const pool = others.filter((o) => o.id !== c.id && o.status !== 'REJECTED' && o.status !== 'DRAFT');
  const who = (o: ClaimFacts) => (o.uid === c.uid ? 'by the same person' : 'by another employee');
  const sameFile = c.billHash ? pool.find((o) => o.billHash && o.billHash === c.billHash) : undefined;
  if (sameFile) flags.push({ kind: 'DUPLICATE_FILE', otherId: sameFile.id, text: `This is the same bill photo as claim ${claimNo(sameFile.id || '')} ${who(sameFile)}.` });
  const v = normVendor(c.vendor || scan?.vendor);
  if (!sameFile && v) {
    const twin = pool.find((o) => normVendor(o.vendor) === v && Math.abs(o.amount - c.amount) < 0.5 && o.expenseDate === c.expenseDate);
    if (twin) flags.push({ kind: 'DUPLICATE_DETAILS', otherId: twin.id, text: `Claim ${claimNo(twin.id || '')} ${who(twin)} has the same shop, amount and date.` });
  }
  if (scan?.amount && scan.amount > 0 && Math.abs(scan.amount - c.amount) > Math.max(1, scan.amount * 0.01)) {
    flags.push({ kind: 'AMOUNT_MISMATCH', text: `The claim says ${rupees(c.amount)} but the bill reads ${rupees(scan.amount)}.` });
  }
  if (scan?.date && scan.date !== c.expenseDate) flags.push({ kind: 'DATE_MISMATCH', text: `The claim date is ${niceDate(c.expenseDate)} but the bill is dated ${niceDate(scan.date)}.` });
  if (scan?.gstin && scan.gstinValid === false) flags.push({ kind: 'GSTIN_INVALID', text: `The GST number on the bill (${scan.gstin}) does not look valid.` });
  return flags;
}
