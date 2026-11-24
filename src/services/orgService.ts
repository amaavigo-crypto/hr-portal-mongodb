/** Group administrators: list the account's organisations and switch between them (api/_lib/orgAdmin.ts). */
import { apiJson, clearApiCache } from './apiClient';
import { auth } from './firebase';
import { clearLocalCaches } from './authService';

export interface OrganisationRow { id: string; name: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; current: boolean; home: boolean }
export interface MyOrganisations { account: { id: string; name: string; orgLimit: number }; organisations: OrganisationRow[] }

export interface TransferBody {
  toCompanyId: string; uids: string[]; effectiveDate?: string; carry?: 'none' | 'all' | 'choose'; carryTypes?: string[];
  perPerson?: Record<string, 'none' | 'all'>; note?: string;
}
export interface TransferOutcomeRow {
  uid: string; name: string; ok: boolean; error?: string; fromEmpId?: string; toEmpId?: string;
  carried?: { type: string; days: number }[]; notCarried?: string[]; cancelledRequests?: number; reportsCleared?: number; departmentsCleared?: number;
}
export interface TransferResponse { moved: number; failed: number; results: TransferOutcomeRow[] }
export interface TransferRequestRow {
  id: string; fromCompanyName: string; toCompanyName: string; status: string; proposedBy: string; createdAt: string; decisionNote?: string;
  input: TransferBody;
}
export interface PreviousEmployment {
  organisation: string; empId: string; until: string; movedTo: string;
  leave: { type: string; from: string; to: string; days: number; status: string }[];
  balances: { typeId: string; cycle: string; days: number }[];
  audit: { action: string; by: string; at: string }[];
}

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

  siblings: () => apiJson<{ direct: boolean; organisations: { id: string; name: string; status: string }[]; leaveTypes: string[] }>('/api/tenant/sibling-organisations'),
  transfer: (b: TransferBody) => apiJson<TransferResponse>('/api/tenant/transfer-people', b),
  propose: (b: TransferBody) => apiJson<{ id: string; status: string }>('/api/tenant/transfer-propose', b),
  requests: () => apiJson<{ requests: TransferRequestRow[] }>('/api/tenant/transfer-requests'),
  decide: (id: string, approve: boolean, note?: string) => apiJson<TransferResponse & { status: string }>('/api/tenant/transfer-decide', { id, approve, note }),
  previousEmployment: (uid: string) => apiJson<{ uid: string; name: string; employments: PreviousEmployment[] }>('/api/tenant/previous-employment', { uid }),

  setGroupAdmin: (email: string, enabled: boolean) => apiJson('/api/tenant/set-group-admin', { email, enabled }),
};
