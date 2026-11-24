/** HR business partner, lifecycle (joining and exit), performance, tasks, wellbeing and the Ask HR assistant. */
import { collection, defineSchema, oneOf, reqStr, tenant, Mixed } from './helpers.js';

export const people = {
  hrbpItems: collection(
    'HR Business Partner and talent-cycle records of many kinds (see HRBP_KINDS in ./hiring.ts): mapping, PIP, survey, recognition, OKR, probation, promotion ...',
    defineSchema({ id: String, ...tenant, kind: reqStr, createdAt: String, updatedAt: String }, [[{ companyId: 1, kind: 1 }]]),
    { pip: defineSchema({ status: oneOf(['DRAFT', 'ACTIVE', 'COMPLETED', 'EXTENDED', 'FAILED', 'CANCELLED']) }) },
  ),

  lifecycleSettings: collection('Joining / exit configuration per company. Document id = companyId.', defineSchema({ companyId: String, updatedAt: String })),
  lifecycleTasks: collection('Joining and exit checklist tasks assigned to employee / HR / manager / IT.', defineSchema({ id: String, ...tenant, uid: String, assigneeUid: String, status: String, kind: oneOf(['DOCUMENT', 'ASSET', 'BANK', 'POLICY', 'GENERAL']), createdAt: String }, [[{ companyId: 1, uid: 1 }], [{ companyId: 1, status: 1 }]])),
  lifecycleExits: collection('Resignation / exit requests and clearance.', defineSchema({ id: String, ...tenant, uid: reqStr, status: oneOf(['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED', 'COMPLETED', 'REJECTED', 'WITHDRAWN']), createdAt: String })),
  lifecycleExitFiles: collection('Files attached to an exit.', defineSchema({ ...tenant, exitId: String, dataUrl: String })),
  lifecycleLetters: collection('Generated letters (offer, confirmation, relieving ...).', defineSchema({ ...tenant, uid: reqStr, createdAt: String }, [[{ companyId: 1, uid: 1 }]])),
  lifecycleBank: collection('Bank details collected at joining. Account numbers are never stored in plain form in logs.', defineSchema({ ...tenant, uid: String })),

  pmSettings: collection('Performance setup per company. Document id = companyId.', defineSchema({ companyId: String })),
  pmTemplates: collection('KRA / KPI templates per designation.', defineSchema({ ...tenant, designation: String })),
  pmPlans: collection('A person\'s performance plan (KPIs, weights, SOPs).', defineSchema({ ...tenant, uid: String, status: String })),
  pmEvidence: collection('Work recorded against a KPI (manual, CSV, sheet feed, or an approved task).', defineSchema({ ...tenant, uid: String, source: String })),
  pmCheckins: collection('Monthly check-ins.', defineSchema({ ...tenant, uid: String })),
  pmCycles: collection('Review cycles (calendar quarters).', defineSchema({ ...tenant, key: String })),
  pmReviews: collection('Quarter reviews with a frozen copy of the plan and weights.', defineSchema({ ...tenant, uid: String, status: String })),
  pmDevPlans: collection('Development / improvement / recognition plans drafted from a review.', defineSchema({ ...tenant, uid: String })),
  pmLog: collection('Audit trail and exceptions of the performance module.', defineSchema({ ...tenant, at: String })),
  pmItems: collection('Older single-collection performance records, kept for existing data.', defineSchema({ ...tenant })),

  taskProjects: collection('Company-wide task projects.', defineSchema({ id: String, ...tenant, name: String })),
  taskItems: collection('Tasks: assignee, reviewer, status (TODO, IN_PROGRESS, IN_REVIEW, REWORK, DONE), checklist, attachments.', defineSchema({ id: String, ...tenant, status: oneOf(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'REWORK', 'DONE']), priority: oneOf(['URGENT', 'HIGH', 'NORMAL', 'LOW']), checklist: [Mixed] })),
  taskLog: collection('Comments and activity trail of tasks.', defineSchema({ ...tenant, taskId: String, at: String })),

  wbConsent: collection('Wellbeing games consent (or opt-out) per person.', defineSchema({ ...tenant, uid: String })),
  wbSessions: collection('Each game session; the server replays the seed and computes the score itself.', defineSchema({ ...tenant, uid: reqStr, game: String }, [[{ companyId: 1, uid: 1 }]])),
  wbDaily: collection('Per-person daily points and streaks.', defineSchema({ ...tenant, uid: String, date: String })),
  wbRoleProfiles: collection('Which skills matter for which job title.', defineSchema({ ...tenant })),
  wbSettings: collection('Wellbeing module settings. Document id = companyId.', defineSchema({ companyId: String })),
  wbAudit: collection('Audit of HR views of individual game results.', defineSchema({ ...tenant, at: String })),

  assistantLogs: collection('Ask HR questions and answers (for quality and cost review).', defineSchema({ ...tenant, uid: String, at: String })),
  agentProposals: collection('Actions Ask HR prepared for a person to confirm (approve/reject, apply leave): status, params, result. Server-only.', defineSchema({ ...tenant, uid: reqStr, action: String, status: oneOf(['PENDING', 'EXECUTING', 'DONE', 'FAILED', 'DISMISSED']) })),
  agentWatchLog: collection('Daily watcher summaries Ask HR sent to a person (one per person per day), shown in the Ask HR panel until dismissed. Server-only.', defineSchema({ ...tenant, uid: reqStr, date: String, seen: Boolean })),
  assistantUsage: collection('Ask HR usage counters per company and month.', defineSchema({ ...tenant })),
};
