/**
 * Talent acquisition. `hiringItems` is one collection told apart by `kind` (see KNOWN_KINDS), so its schema is a base
 * (id, companyId, kind) plus extra rules for the kinds whose shape is fixed.
 */
import { collection, defineSchema, oneOf, reqStr, stamps, tenant, Mixed } from './helpers.js';

/** Every `kind` value found in the code today. Add new kinds here when you add them to the app. */
export const HIRING_KINDS = [
  'posting', 'jdTemplate', 'referral', 'resume', 'scoreSettings', 'rating', 'position', 'assessment', 'screening',
  'interview', 'offer', 'offerTpl', 'kitTemplate', 'flow', 'flowFamily', 'flowRun', 'flowTask', 'skillTest', 'scrlink',
  'google', 'data', 'mapping', 'policy',
] as const;

export const HRBP_KINDS = [
  'mapping', 'transfer', 'talentReview', 'pip', 'surveyResponse', 'surveyDone', 'survey', 'succession', 'retention',
  'recognition', 'wellness', 'trainingNeed', 'learningPath', 'learningAssign', 'okr', 'prob', 'promo', 'kpi', 'hcost',
] as const;

export const hiring = {
  hiringItems: collection(
    'Hiring pipeline records of many kinds (job posts, referrals, screenings, interviews, offers, hiring-flow definitions and runs ...). Always read with companyId + kind.',
    defineSchema({ id: String, ...tenant, kind: reqStr, createdAt: String, updatedAt: String }, [[{ companyId: 1, kind: 1 }]]),
    {
      flowRun: defineSchema({
        applicationId: reqStr,
        flowId: String,
        flowVersion: Number,
        familyId: String,
        stepId: String,
        status: oneOf(['RUNNING', 'WAITING', 'STUCK', 'HIRED', 'REJECTED', 'STOPPED'], true),
        stuckReason: String,
        enteredAt: String,
        waitUntil: String,
        decisions: Mixed,
        history: [Mixed],
      }),
      flowFamily: defineSchema({ familyId: reqStr, name: reqStr, designations: [String], isDefault: Boolean, retired: Boolean }),
    },
  ),

  applications: collection(
    'A candidate application. Repeat applications by the same person are merged into the latest in rankings.',
    defineSchema(
      {
        id: String,
        ...tenant,
        name: reqStr,
        email: String,
        emailLower: String,
        mobile: String,
        city: String,
        designation: String,
        designationKey: String,
        requisitionId: String,
        experience: String,
        noticePeriod: String,
        status: String,
        interviewDate: String,
        resumeUrl: String,
        extra: Mixed,
        source: Mixed,
        reappliedAt: String,
        receivedAt: String,
        currentCtcLpa: Number,
        expectedCtcLpa: Number,
        qualification: String,
        totalExperienceYears: Number,
        ...stamps,
      },
      [[{ companyId: 1, emailLower: 1 }], [{ companyId: 1, designationKey: 1 }]],
    ),
  ),

  candidateEvaluations: collection('AI / resume-match evaluation of a candidate against a job description.', defineSchema({ ...tenant, applicationId: String, updatedAt: String })),

  requisitions: collection(
    'A request to hire. Flow: PENDING_ASSIGNMENT, PENDING_HR, PENDING_FOUNDER, JD_DRAFT, JOB_OPEN, then CLOSED (or REJECTED). Shape: src/types (Requisition).',
    defineSchema(
      {
        id: String,
        ...tenant,
        reqNo: String,
        positionTitle: reqStr,
        departmentName: String,
        vacancies: Number,
        employmentType: oneOf(['Full-time', 'Part-time', 'Contract', 'Internship']),
        location: String,
        minExperienceYears: Number,
        maxExperienceYears: Number,
        urgency: oneOf(['LOW', 'MEDIUM', 'HIGH']),
        workMode: oneOf(['Office', 'Remote', 'Hybrid']),
        ctcMinLpa: Number,
        ctcMaxLpa: Number,
        positionId: String, // POS-<CO>-<YEAR>-<NNN>, issued at founder approval
        budgetCheck: Mixed,
        justification: String,
        keySkills: String,
        status: oneOf(['PENDING_ASSIGNMENT', 'PENDING_HR', 'PENDING_FOUNDER', 'JD_DRAFT', 'JOB_OPEN', 'REJECTED', 'CLOSED'], true),
        requestedBy: Mixed,
        raisedBy: Mixed,
        ownerHr: Mixed,
        hrDecision: Mixed,
        founderDecision: Mixed,
        jd: Mixed,
        jobId: String,
        flowFamilyId: String,
        publishedAt: String,
        closedReason: String,
        events: [Mixed],
        ...stamps,
      },
      [[{ companyId: 1, status: 1 }]],
    ),
  ),

  hiringBudgets: collection('Approved headcount and maximum CTC per department.', defineSchema({ ...tenant, department: String, headcount: Number, maxCtcLpa: Number })),
  recruitmentSettings: collection('Per-company hiring settings (sources, careers site, scoring). Document id = companyId.', defineSchema({ companyId: String, updatedAt: String })),
  onboardings: collection('Joining board record for a selected candidate: documents, kit, IT accounts, assets.', defineSchema({ id: String, ...tenant, offerId: String, requisitionId: String, positionId: String, kit: Mixed, itAccounts: Mixed, updatedAt: String })),
  onboardingFiles: collection('Documents uploaded for onboarding.', defineSchema({ ...tenant, onboardingId: String })),
  jobDescriptions: collection('Edited job descriptions that take priority over the requisition JD. Document id = role key.', defineSchema({ ...tenant, text: String, updatedAt: String })),
  candidateStatuses: collection('Status overrides for candidates.', defineSchema({ ...tenant, status: String })),
  integrationSecrets: collection('Server-only third-party connection secrets (Teams, WhatsApp ...). Never sent to the browser.', defineSchema({ ...tenant })),
};
