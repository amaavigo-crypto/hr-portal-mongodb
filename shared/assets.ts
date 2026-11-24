/** Company asset lifecycle rules and book value. Pure functions, no database. */
export const ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetAction = 'assign' | 'return' | 'send_repair' | 'repair_done' | 'retire' | 'lost' | 'found';

const NEXT: Record<AssetAction, { from: AssetStatus[]; to: AssetStatus }> = {
  assign: { from: ['IN_STOCK'], to: 'ASSIGNED' },
  return: { from: ['ASSIGNED'], to: 'IN_STOCK' },
  send_repair: { from: ['IN_STOCK', 'ASSIGNED'], to: 'IN_REPAIR' },
  repair_done: { from: ['IN_REPAIR'], to: 'IN_STOCK' },
  retire: { from: ['IN_STOCK', 'IN_REPAIR'], to: 'RETIRED' },
  lost: { from: ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR'], to: 'LOST' },
  found: { from: ['LOST'], to: 'IN_STOCK' },
};

const LABEL: Record<AssetStatus, string> = { IN_STOCK: 'in stock', ASSIGNED: 'assigned', IN_REPAIR: 'in repair', RETIRED: 'retired', LOST: 'lost' };

export function transition(status: AssetStatus, action: AssetAction): { ok: true; to: AssetStatus } | { ok: false; error: string } {
  const rule = NEXT[action];
  if (!rule) return { ok: false, error: 'Unknown action.' };
  if (!rule.from.includes(status)) return { ok: false, error: `An asset that is ${LABEL[status]} cannot be ${action.replace('_', ' ')}ed that way.` };
  return { ok: true, to: rule.to };
}

const monthsBetween = (from: string, to: string) => {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};

/** Straight-line book value: cost down to salvage over the useful life, never below salvage, never above cost. */
export function bookValue(a: { cost: number; salvage?: number; purchaseDate: string; usefulLifeMonths: number }, asOf: string): number {
  const cost = Math.max(0, a.cost || 0), salvage = Math.min(cost, Math.max(0, a.salvage || 0));
  if (!a.purchaseDate || !(a.usefulLifeMonths > 0)) return Math.round(cost * 100) / 100;
  const used = Math.min(a.usefulLifeMonths, Math.max(0, monthsBetween(a.purchaseDate, asOf)));
  return Math.round((cost - ((cost - salvage) * used) / a.usefulLifeMonths) * 100) / 100;
}

/** 'EXPIRED', 'EXPIRING' (within 60 days), 'IN_WARRANTY' or 'UNKNOWN'. */
export function warrantyState(until: string, today: string): 'EXPIRED' | 'EXPIRING' | 'IN_WARRANTY' | 'UNKNOWN' {
  if (!until) return 'UNKNOWN';
  if (until < today) return 'EXPIRED';
  const days = (new Date(until + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86400_000;
  return days <= 60 ? 'EXPIRING' : 'IN_WARRANTY';
}

export const CONDITIONS = ['GOOD', 'FAIR', 'DAMAGED'] as const;
export const MAX_HISTORY = 200;
