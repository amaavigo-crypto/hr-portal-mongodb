import { apiJson } from './apiClient';
import type { GameId } from '../../shared/wellbeingEngine';

const base = '/api/leave/wellbeing-';
const qs = (p: Record<string, string | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return s ? `?${s}` : '';
};

export interface MeGame { id: GameId; name: string; tagline: string; minutes: number; best: number; version: number }
export interface Me {
  consent: { answered: boolean; optedIn: boolean; version: number };
  games: MeGame[];
  today: { plays: number; cap: number; left: number };
  streak: number;
  recent: { game: GameId; points: number; at: string }[];
  access: { view: boolean; viewIndividual: boolean; manage: boolean };
}
export interface StartResult { sessionId: string | null; seed: string; recorded: boolean; today: { plays: number; cap: number; left: number } }
export interface FinishResult { points: number; highlight: string; previousBest: number; newBest: boolean; today: { plays: number; cap: number; left: number }; streak: number }

/** Every Wellbeing call. Server side: api/_lib/wellbeingApi.ts (served through the leave function). */
export const wellbeingService = {
  me: () => apiJson<Me>(`${base}me`),
  progress: () => apiJson<any>(`${base}progress`),
  consent: (optIn: boolean) => apiJson(`${base}consent`, { optIn }),
  start: (game: GameId) => apiJson<StartResult>(`${base}start`, { game }),
  finish: (sessionId: string, payload: unknown) => apiJson<FinishResult>(`${base}finish`, { sessionId, payload }),
  forgetMe: () => apiJson<{ deleted: number }>(`${base}forget-me`, {}),
  // HR
  overview: () => apiJson<any>(`${base}overview`),
  people: () => apiJson<any>(`${base}people`),
  person: (uid: string) => apiJson<any>(`${base}person${qs({ uid })}`),
  audit: () => apiJson<any>(`${base}audit`),
  roles: () => apiJson<any>(`${base}roles`),
  saveRole: (title: string, weights: Record<string, number>) => apiJson(`${base}save-role`, { title, weights }),
  resetRole: (title: string) => apiJson(`${base}reset-role`, { title }),
  settings: () => apiJson<any>(`${base}settings`),
  saveSettings: (enabledGames: string[], dailyCap: number) => apiJson(`${base}save-settings`, { enabledGames, dailyCap }),
};
