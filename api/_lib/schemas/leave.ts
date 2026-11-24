/** Leave & attendance. Balances are a ledger: every change is an entry, nothing is overwritten. */
import { collection, defineSchema, oneOf, reqNum, reqStr, stamps, tenant, Mixed } from './helpers.js';

const REQUEST_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CANCEL_REQUESTED', 'INFO_REQUESTED', 'WITHDRAWN'] as const;
const LEDGER_KIND = ['OPENING', 'ACCRUAL', 'USED', 'RESTORED', 'ADJUST', 'ENCASH', 'LAPSE', 'CARRY_OUT', 'CARRY_IN'] as const;

export const leave = {
  leaveSettings: collection(
    'Company leave setup: year start, locations (weekly offs + holidays), leave types, policies, shift and late rules. Document id = companyId. Shapes: shared/leaveEngine.ts (LeaveSettings).',
    defineSchema({
      companyId: String,
      yearStartMonth: Number,
      probationDays: Number,
      yearEndSignoff: Boolean,
      sandwichRule: Boolean,
      locations: [Mixed],
      types: [Mixed],
      policies: [Mixed],
      shift: Mixed,
      lateMarksPerHalfDay: Number,
      cycleStartDay: Number,
      updatedAt: String,
    }),
  ),

  leaveProfiles: collection(
    'Per-person leave setup: location, policy, manager, join date. Document id = `<companyId>__<uid>`.',
    defineSchema(
      {
        ...tenant,
        uid: reqStr,
        locationId: String,
        policyId: String,
        managerUid: String,
        managerManual: Boolean,
        joinDate: String,
        gender: oneOf(['F', 'M', 'O', '']),
        hidden: Boolean,
        updatedAt: String,
      },
      [[{ companyId: 1, uid: 1 }], [{ companyId: 1, managerUid: 1 }]],
    ),
  ),

  leaveLedger: collection(
    'Leave balance ledger. Balance of a type in a cycle = sum of `delta`.',
    defineSchema(
      {
        id: String,
        ...tenant,
        uid: reqStr,
        typeId: reqStr,
        cycle: String,
        delta: reqNum,
        kind: oneOf(LEDGER_KIND, true),
        date: String,
        ref: String,
        note: String,
        by: String,
        createdAt: String,
      },
      [[{ companyId: 1, uid: 1 }]],
    ),
  ),

  leaveRequests: collection(
    'A leave application and its approval steps. Reserves balance while PENDING.',
    defineSchema(
      {
        id: String,
        ...tenant,
        uid: reqStr,
        name: String,
        email: String,
        managerUid: String,
        typeId: reqStr,
        typeName: String,
        typeCode: String,
        requiresBalance: Boolean,
        from: reqStr, // YYYY-MM-DD
        to: reqStr,
        halfFrom: Boolean,
        halfTo: Boolean,
        halfPart: oneOf(['FIRST', 'SECOND']),
        days: Number,
        detail: [Mixed], // [{ date, value }]
        byCycle: Mixed, // { cycleKey: days }
        reason: String,
        docUrl: String,
        privateDocId: String,
        warnings: [String],
        policyVersion: Number,
        emergency: Boolean,
        status: oneOf(REQUEST_STATUS, true),
        steps: [Mixed], // [{ role: MANAGER|HR, status, by, at, comment }]
        stepIndex: Number,
        onBehalfOf: Boolean,
        createdBy: String,
        events: [Mixed], // [{ at, by, message }]
        ...stamps,
      },
      [[{ companyId: 1, uid: 1 }], [{ companyId: 1, status: 1 }]],
    ),
  ),

  leaveAttendance: collection(
    'One attendance day for one person. `sessions` = punch in/out stretches; `checkIn`/`checkOut` mirror first in and last out.',
    defineSchema(
      {
        ...tenant,
        uid: reqStr,
        date: String, // YYYY-MM-DD
        month: String, // YYYY-MM
        checkIn: String,
        checkOut: String,
        sessions: [Mixed],
        updatedAt: String,
      },
      [[{ companyId: 1, uid: 1, month: 1 }], [{ companyId: 1, month: 1 }]],
    ),
  ),

  leaveRegularizations: collection(
    'Missed-punch corrections and attendance applications (AA-... numbers), approved by the manager or HR.',
    defineSchema({ id: String, ...tenant, uid: reqStr, status: String, createdAt: String }, [[{ companyId: 1, uid: 1 }], [{ companyId: 1, status: 1 }]]),
  ),

  leaveDelegations: collection('A manager hands approvals to someone for a date range. Document id = `<companyId>__<managerUid>`.', defineSchema({ ...tenant, managerUid: reqStr, delegateUid: reqStr, from: String, to: String }, [[{ companyId: 1, delegateUid: 1 }]])),
  leaveNotifications: collection('Leave-related notifications for a person.', defineSchema({ ...tenant, uid: reqStr, message: String, read: Boolean, createdAt: String }, [[{ companyId: 1, uid: 1 }]])),
  leaveExceptions: collection(
    'Exceptions and flags for HR to review (payroll checks, late marks, leave patterns).',
    defineSchema(
      { id: String, ...tenant, category: String, severity: oneOf(['LOW', 'MEDIUM', 'HIGH']), message: String, requestId: String, uid: String, assignedTo: String, status: oneOf(['OPEN', 'RESOLVED']), createdAt: String, resolvedAt: String, resolvedBy: String, resolution: String, flag: Mixed },
      [[{ companyId: 1, category: 1 }]],
    ),
  ),
  leaveDocs: collection('Metadata of supporting documents attached to leave requests.', defineSchema({ ...tenant, uid: String, name: String, createdAt: String })),
  leaveDocData: collection('File data (data URLs) of leave supporting documents.', defineSchema({ ...tenant, dataUrl: String })),
  leaveAudit: collection('Audit trail of leave setup changes.', defineSchema({ ...tenant, action: String, by: String, at: String })),
  leaveLocks: collection('Short-lived locks that stop two daily jobs running together.', defineSchema({ at: String })),
  leavePayrollInputs: collection('Unpaid leave days handed to payroll for a month.', defineSchema({ ...tenant, uid: String, applyMonth: String })),
  leavePolicyDrafts: collection('Leave policy changes waiting to be published.', defineSchema({ ...tenant, updatedAt: String })),
  leavePolicyVersions: collection('Published versions of the leave policy (history stays traceable).', defineSchema({ ...tenant, version: Number, createdAt: String })),
  leaveYearClose: collection('Year-end carry-forward / lapse / encashment sign-off per leave year.', defineSchema({ ...tenant, status: String })),
};
