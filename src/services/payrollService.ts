import { apiJson } from './apiClient';

// Payroll shares the leave serverless function: /api/leave/payroll-<action>
const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return apiJson<T>(`/api/leave/payroll-${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/leave/payroll-${action}`, body);

export const payrollService = {
  me: () => get('me'),
  myPayslips: () => get('my-payslips'),
  payslip: (month: string, uid?: string) => get('payslip', { month, uid }),
  settings: () => get('settings'),
  saveSettings: (settings: unknown) => post('save-settings', { settings }),
  applyStarter: () => post('apply-starter'),
  structures: () => get('structures'),
  structure: (uid: string) => get('structure', { uid }),
  saveStructure: (b: unknown) => post('save-structure', b),
  splitCtc: (annualCtc: number) => post('split-ctc', { annualCtc }),
  importStructures: (rows: unknown[]) => post('import-structures', { rows }),
  inputs: (month: string) => get('inputs', { month }),
  adjustments: (month: string) => get('adjustments', { month }),
  saveAdjustment: (b: unknown) => post('save-adjustment', b),
  deleteAdjustment: (id: string) => post('delete-adjustment', { id }),
  loans: () => get('loans'),
  saveLoan: (b: unknown) => post('save-loan', b),
  closeLoan: (id: string) => post('close-loan', { id }),
  runs: () => get('runs'),
  run: (month: string) => get('run', { month }),
  calculate: (month: string) => post('calculate', { month }),
  setOverride: (b: unknown) => post('set-override', b),
  approve: (month: string, expectedNet: number, force = false) => post('approve', { month, expectedNet, force }),
  reopen: (month: string) => post('reopen', { month }),
  lock: (month: string) => post('lock', { month }),
  markPaid: (month: string, paidOn?: string, ref?: string) => post('mark-paid', { month, paidOn, ref }),
  deleteRun: (month: string) => post('delete-run', { month }),
  exportRun: (month: string, kind: string) => get('export', { month, kind }),
  // accounting export
  accountingMapping: () => get('accounting-mapping'),
  saveAccountingMapping: (b: unknown) => post('save-accounting-mapping', b),
  accountingExport: (month: string, format: 'tally' | 'quickbooks' | 'preview', dateFormat?: string) => get('accounting-export', { month, format, dateFormat }),
  // statutory filings
  statutoryDues: (month: string) => get('statutory-dues', { month }),
  statutoryFile: (month: string, kind: 'ecr' | 'esi' | 'lwf') => get('statutory-file', { month, kind }),
  statutoryTds: (fy: string, quarter: number) => get('statutory-tds', { fy, quarter: String(quarter) }),
  challans: () => get('challans'),
  saveChallan: (b: unknown) => post('save-challan', b),
  deleteChallan: (id: string) => post('delete-challan', { id }),
  // salary revisions
  revisions: (uid?: string) => get('revisions', { uid }),
  saveRevision: (b: unknown) => post('save-revision', b),
  cancelRevision: (id: string) => post('cancel-revision', { id }),
  applyRevisions: (month: string, dryRun: boolean) => post('apply-revisions', { month, dryRun }),
  // reimbursements
  myClaims: () => get('my-claims'),
  submitClaim: (b: unknown) => post('submit-claim', b),
  withdrawClaim: (id: string) => post('withdraw-claim', { id }),
  claims: (status?: string) => get('claims', { status }),
  decideClaim: (b: unknown) => post('decide-claim', b),
  claimBill: (id: string) => get('claim-bill', { id }),
  claimFile: (id: string, fileId: string) => get('claim-file', { id, fileId }),
  saveClaimDraft: (b: unknown) => post('claim-draft-save', b),
  scanClaimDraft: (id: string) => post('claim-draft-scan', { id }),
  removeClaimDraftFile: (id: string, fileId: string) => post('claim-draft-remove-file', { id, fileId }),
  // full and final settlement
  settlements: () => get('settlements'),
  settlement: (uid?: string) => get('settlement', { uid }),
  saveSettlement: (b: unknown) => post('save-settlement', b),
  approveSettlement: (uid: string, expectedNet: number) => post('approve-settlement', { uid, expectedNet }),
  reopenSettlement: (uid: string) => post('reopen-settlement', { uid }),
  paySettlement: (uid: string, paidOn?: string, ref?: string) => post('pay-settlement', { uid, paidOn, ref }),
  deleteSettlement: (uid: string) => post('delete-settlement', { uid }),
  // income tax
  taxDeclaration: (fy?: string, uid?: string) => get('tax-declaration', { fy, uid }),
  saveTaxDeclaration: (b: unknown) => post('save-tax-declaration', b),
  verifyDeclaration: (b: unknown) => post('verify-declaration', b),
  taxDeclarations: (fy?: string) => get('tax-declarations', { fy }),
  taxPreview: (uid?: string) => get('tax-preview', { uid }),
  taxStatement: (fy?: string, uid?: string) => get('tax-statement', { fy, uid }),
  tdsRegister: (fy?: string) => get('tds-register', { fy }),
  controls: () => get('controls'),
  saveControls: (controls: unknown) => post('save-controls', { controls }),
  approvalState: (month: string) => get('approval-state', { month }),
  approvalStep: (b: { month: string; step: string; expectedHash: string; note?: string; force?: boolean }) => post('approval-step', b),
  calendar: (month: string) => get('calendar', { month }),
  freezeMonth: (month: string) => post('period-freeze', { month }),
  unfreezeMonth: (month: string, reason: string) => post('period-unfreeze', { month, reason }),
  payment: (month: string) => get('payment', { month }),
  paymentCreate: (month: string) => post('payment-create', { month }),
  paymentSubmit: (month: string, ref?: string) => post('payment-submit', { month, ref }),
  paymentImport: (month: string, csv: string) => post('payment-import', { month, csv }),
  paymentMark: (b: unknown) => post('payment-mark', b),
  paymentRetry: (month: string, uids?: string[]) => post('payment-retry', { month, uids }),
  paymentExport: (month: string, only?: string) => get('payment-export', { month, only }),
  paymentClose: (month: string, paidOn?: string) => post('payment-close', { month, paidOn }),
  salaryVersions: (uid: string, asOf?: string) => get('salary-versions', { uid, asOf }),
  saveCostCentres: (items: unknown[]) => post('save-cost-centres', { items }),
  costAllocations: () => get('cost-allocations'),
  costAllocation: (uid: string) => get('cost-allocation', { uid }),
  saveCostAllocation: (uid: string, rows: unknown[]) => post('save-cost-allocation', { uid, rows }),
  costReport: (month: string) => get('cost-report', { month }),
};

export const inr = (n: number | undefined | null) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n) || 0);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m: string) => `${MONTHS[parseInt(m.slice(5, 7), 10) - 1] || m} ${m.slice(0, 4)}`;
export const shiftMonth = (m: string, delta: number) =>
  new Date(Date.UTC(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1 + delta, 1)).toISOString().slice(0, 7);
export const previousMonth = () => shiftMonth(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7), -1);
