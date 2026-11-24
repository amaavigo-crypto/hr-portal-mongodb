/** Payroll. Every record carries companyId; a run is one company-month and the document id is derived from both. */
import { collection, defineSchema, oneOf, reqNum, reqStr, tenant, Mixed } from './helpers.js';

export const payroll = {
  payrollSettings: collection('Company payroll setup (components, CTC template, PF / ESIC / PT, tax, claim categories). Document id = companyId. Shape: shared/payrollEngine.ts (PayrollSettings).', defineSchema({ companyId: String, daysBasis: oneOf(['CALENDAR', 'FIXED_30']), attendanceMode: oneOf(['ATTENDANCE', 'LEAVE_ONLY']), components: [Mixed], ctcTemplate: [Mixed], pf: Mixed, esic: Mixed, pt: Mixed, tax: Mixed, claims: Mixed, updatedAt: String })),
  payrollStructures: collection('Salary structure of a person: full-month amount per component. Document id = employee uid (per company).', defineSchema({ ...tenant, uid: String, amounts: Mixed, state: String, gender: oneOf(['F', 'M', 'O', '']), pfApplicable: Boolean, esicApplicable: Boolean, pfOnActualWage: Boolean, updatedAt: String })),
  payrollRevisions: collection('History of salary revisions (increments).', defineSchema({ ...tenant, uid: String, createdAt: String })),
  payrollRuns: collection(
    'One payroll run per company and month. Status moves DRAFT, APPROVED, LOCKED, PAID.',
    defineSchema(
      {
        ...tenant,
        month: reqStr, // YYYY-MM
        status: oneOf(['DRAFT', 'APPROVED', 'LOCKED', 'PAID'], true),
        totals: Mixed,
        warnings: [String],
        skipped: [Mixed],
        overrides: Mixed,
        calculatedAt: String,
        calculatedBy: String,
        approvedAt: String,
        approvedBy: String,
        lockedAt: String,
        lockedBy: String,
        paidAt: String,
        paidBy: String,
        paidOn: String,
        paidRef: String,
        events: [Mixed],
      },
      [[{ companyId: 1, month: 1 }]],
    ),
  ),
  payrollRunLines: collection('One payslip line per person per run (earnings, deductions, loans, reimbursements, net pay).', defineSchema({ ...tenant, month: reqStr, uid: reqStr, employee: Mixed }, [[{ companyId: 1, month: 1 }], [{ companyId: 1, uid: 1 }]])),
  payrollAdjustments: collection('One-off earnings / deductions added to a month.', defineSchema({ ...tenant, uid: String, month: String, kind: oneOf(['EARNING', 'DEDUCTION']), label: String, amount: reqNum }, [[{ companyId: 1, month: 1 }]])),
  payrollLoans: collection('Loans and advances recovered in instalments.', defineSchema({ ...tenant, uid: reqStr, label: String, principal: Number, installment: Number, balance: Number, active: Boolean, appliedMonths: [String], note: String, by: String, createdAt: String })),
  payrollDeclarations: collection('Employee tax declarations for a financial year.', defineSchema({ ...tenant, uid: String, fy: String }, [[{ companyId: 1, fy: 1 }]])),
  payrollSettlements: collection('Full and final settlements for leavers.', defineSchema({ ...tenant, uid: String, status: String, createdAt: String })),
  payrollClaims: collection(
    'Expense reimbursement claims. Photos live in payrollClaimFiles; approved claims are paid with a salary run.',
    defineSchema(
      {
        ...tenant,
        uid: reqStr,
        category: String,
        description: String,
        amount: reqNum,
        expenseDate: String,
        status: oneOf(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'], true),
        approvedAmount: Number,
        decisionNote: String,
        decidedBy: String,
        decidedAt: String,
        paidMonth: String,
        hasBill: Boolean,
        billName: String,
        files: [Mixed], // [{ id, kind: BILL|PROOF, name, type, takenAt }]
        scan: Mixed,
        flags: [Mixed],
        billHash: String,
        vendor: String,
        createdAt: String,
      },
      [[{ companyId: 1, uid: 1 }], [{ companyId: 1, status: 1 }]],
    ),
  ),
  payrollClaimFiles: collection('Claim photo data (data URLs), one document per photo.', defineSchema({ ...tenant, claimId: String, uid: String, dataUrl: String })),
};
