/** Group administrators: list the account's organisations and switch between them (api/_lib/orgAdmin.ts). */
import { apiJson, clearApiCache } from './apiClient';
import { auth } from './firebase';
import { clearLocalCaches } from './authService';

export interface OrganisationRow { id: string; name: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; current: boolean; home: boolean }
export interface MyOrganisations { account: { id: string; name: string; orgLimit: number }; organisations: OrganisationRow[] }

export const orgService = {
  list: () => apiJson<MyOrganisations & { success: true }>('/api/tenant/my-organisations'),

  /** Switches the organisation on the server, then reloads so nothing from the previous organisation stays on screen. */
  async switchTo(companyId: string): Promise<void> {
    await apiJson('/api/tenant/switch-organisation', { companyId });
    await auth.currentUser?.getIdToken(true); // pick up the new claims
    clearApiCache();
    clearLocalCaches();
    window.location.reload();
  },

  setGroupAdmin: (email: string, enabled: boolean) => apiJson('/api/tenant/set-group-admin', { email, enabled }),
};
