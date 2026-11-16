/**
 * Extra MongoDB indexes, created (in the background, once per server start) the first time a collection is used.
 * Every collection also gets `{ companyId: 1 }` (see ensureIndexes in mongoFirestore.ts).
 *
 * Built from the queries the API actually runs: company + the field it filters on, plus the few lookups that are not
 * per company (sign-in by authUid, offer / test links by token, webhooks). A longer index also serves its prefix, so
 * { companyId, uid, month } covers queries on { companyId, uid } too. When you add a query that filters a large
 * collection on a new field, add it here.
 */
export const MONGO_INDEXES: Record<string, Record<string, 1>[]> = {
  acknowledgments: [{ companyId: 1, employeeId: 1 }, { companyId: 1, status: 1 }],
  applications: [{ companyId: 1, emailLower: 1 }],
  companies: [{ status: 1 }],
  employeeFamily: [{ companyId: 1, uid: 1 }],
  employeeIdentities: [{ companyId: 1, uid: 1 }],
  employeeIdentityFiles: [{ companyId: 1, uid: 1, type: 1 }],
  employeeQualifications: [{ companyId: 1, uid: 1 }],
  employees: [{ authUid: 1 }, { companyId: 1, departmentId: 1 }, { companyId: 1, email: 1 }, { companyId: 1, roleIds: 1 }],
  hiringItems: [{ companyId: 1, kind: 1, applicationId: 1 }, { kind: 1 }, { token: 1 }],
  hrbpItems: [{ companyId: 1, kind: 1 }, { kind: 1 }],
  leaveAttendance: [{ companyId: 1, month: 1 }, { companyId: 1, uid: 1, month: 1 }],
  leaveDelegations: [{ companyId: 1, delegateUid: 1 }],
  leaveExceptions: [{ companyId: 1, category: 1 }],
  leaveLedger: [{ companyId: 1, uid: 1 }],
  leaveNotifications: [{ companyId: 1, uid: 1 }],
  leavePayrollInputs: [{ companyId: 1, applyMonth: 1 }],
  leaveProfiles: [{ companyId: 1, managerUid: 1 }],
  leaveRegularizations: [{ companyId: 1, status: 1 }, { companyId: 1, uid: 1 }],
  leaveRequests: [{ companyId: 1, status: 1 }, { companyId: 1, uid: 1 }],
  lifecycleLetters: [{ companyId: 1, uid: 1 }],
  lifecycleTasks: [{ companyId: 1, assigneeUid: 1 }, { companyId: 1, status: 1 }, { companyId: 1, uid: 1 }],
  payrollAdjustments: [{ companyId: 1, month: 1 }],
  payrollClaims: [{ companyId: 1, status: 1 }, { companyId: 1, uid: 1 }],
  payrollDeclarations: [{ companyId: 1, fy: 1 }],
  payrollRunLines: [{ companyId: 1, month: 1 }, { companyId: 1, uid: 1 }],
  recruitmentSettings: [{ webhookId: 1 }],
  requisitions: [{ companyId: 1, status: 1 }],
  versions: [{ companyId: 1, status: 1 }],
};

export const indexName = (keys: Record<string, 1>) => Object.keys(keys).map((k) => `${k}_1`).join('_');
