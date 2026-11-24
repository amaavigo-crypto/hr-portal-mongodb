/**
 * The workplace routers share the leave serverless function (Vercel Hobby allows only 12 functions), reached as
 * /api/leave/<prefix>-<action>. One place maps prefix to router so server.ts and api/leave/[action].ts stay in step.
 */
import type { WorkReq, Result } from './workKit.js';

const ROUTERS: Record<string, () => Promise<(r: WorkReq) => Promise<Result>>> = {
  'esign-': async () => (await import('./esignApi.js')).routeEsign,
  'assets-': async () => (await import('./assetApi.js')).routeAssets,
  'engage-': async () => (await import('./engageApi.js')).routeEngage,
};

export async function routePrefixed(action: string, req: { method: string; query: Record<string, any>; body: any; headers: Record<string, any>; ip?: string }): Promise<Result | undefined> {
  for (const [prefix, load] of Object.entries(ROUTERS)) {
    if (!action.startsWith(prefix)) continue;
    const route = await load();
    return route({ method: req.method, action: action.slice(prefix.length), query: req.query || {}, body: req.body, headers: req.headers, ip: req.ip });
  }
  return undefined;
}
