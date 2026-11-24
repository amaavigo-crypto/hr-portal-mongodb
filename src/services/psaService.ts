import { apiJson } from './apiClient';

const get = (action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return apiJson<any>(`/api/leave/psa-${action}${qs ? `?${qs}` : ''}`);
};
const post = (action: string, body: unknown = {}) => apiJson<any>(`/api/leave/psa-${action}`, body);

export const psaService = {
  clients: () => get('clients'), saveClient: (b: unknown) => post('save-client', b),
  projects: () => get('projects'), saveProject: (b: unknown) => post('save-project', b),
  allocations: (projectId?: string) => get('allocations', { projectId }), saveAllocation: (b: unknown) => post('save-allocation', b), deleteAllocation: (id: string) => post('delete-allocation', { id }),
  load: (weekStart?: string) => get('load', { weekStart }),
  myProjects: () => get('my-projects'),
  sheet: (weekStart: string, uid?: string) => get('sheet', { weekStart, uid }),
  saveSheet: (weekStart: string, entries: unknown[]) => post('save-sheet', { weekStart, entries }),
  submitSheet: (weekStart: string) => post('submit-sheet', { weekStart }),
  queue: () => get('queue'), decide: (id: string, approve: boolean, note?: string) => post('decide-sheet', { id, approve, note }),
  billable: (clientId: string, from: string, to: string) => get('billable', { clientId, from, to }),
  createInvoice: (b: unknown) => post('create-invoice', b),
  invoices: () => get('invoices'), invoice: (id: string) => get('invoice', { id }), invoiceStatus: (id: string, status: string) => post('invoice-status', { id, status }),
  utilisation: (from: string, to: string) => get('utilisation', { from, to }),
};
