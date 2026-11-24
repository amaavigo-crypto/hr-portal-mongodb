/** Workplace tools: e-signature, surveys, social wall, assets. Configuration builders and projects are added alongside. */
import { collection, defineSchema, oneOf, reqNum, reqStr, tenant, Mixed } from './helpers.js';

export const workplace = {
  esignRequests: collection(
    'A document sent for e-signature. The text is fixed at creation and `docHash` (SHA-256) identifies exactly what was signed. `events` is the audit trail.',
    defineSchema({
      ...tenant, id: String, title: reqStr, body: String, docHash: String, createdBy: reqStr, createdByName: String, createdAt: String,
      ordered: Boolean, expiresAt: String, status: oneOf(['PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']), completedAt: String,
      signers: [Mixed], events: [Mixed],
    }),
  ),
  surveys: collection(
    'A survey or feedback form. `salt` is server-only and keys the opaque ids of anonymous answers. Status DRAFT, OPEN, CLOSED.',
    defineSchema({
      ...tenant, id: String, title: reqStr, description: String, anonymous: Boolean, questions: [Mixed], audience: Mixed, closesAt: String,
      status: oneOf(['DRAFT', 'OPEN', 'CLOSED']), salt: String, createdBy: String, createdAt: String, updatedAt: String, openedAt: String, closedAt: String,
    }),
  ),
  surveyResponses: collection(
    'One person\'s answers to a survey. Anonymous surveys store no uid: the id is an HMAC of the person and the survey, and the time is rounded to the day.',
    defineSchema({ ...tenant, surveyId: reqStr, answers: Mixed, uid: String, name: String, submittedAt: String }),
  ),
  wallPosts: collection(
    'Social wall posts: POST, KUDOS (kudosTo = uids) or ANNOUNCEMENT. `reactions` maps LIKE / CELEBRATE / INSIGHT to the uids who reacted.',
    defineSchema({ ...tenant, id: String, kind: oneOf(['POST', 'KUDOS', 'ANNOUNCEMENT']), text: reqStr, authorUid: reqStr, authorName: String, kudosTo: [String], pinned: Boolean, reactions: Mixed, createdAt: String }),
  ),
  wallComments: collection('A comment on a wall post.', defineSchema({ ...tenant, id: String, postId: reqStr, text: reqStr, authorUid: reqStr, authorName: String, createdAt: String })),
  assets: collection(
    'A company asset (laptop, phone, desk ...). Status IN_STOCK, ASSIGNED, IN_REPAIR, RETIRED, LOST. `history` keeps the last 200 events. Book value is straight-line from cost, salvage and useful life.',
    defineSchema({
      ...tenant, id: String, tag: reqStr, name: reqStr, category: String, serial: String, vendor: String, notes: String, status: oneOf(['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST']),
      assignedTo: String, assignedToName: String, assignedAt: String, acknowledgedAt: String, purchaseDate: String, warrantyUntil: String, cost: Number, salvage: Number, usefulLifeMonths: Number,
      history: [Mixed], createdAt: String, createdBy: String, updatedAt: String,
    }),
  ),
  customFieldDefs: collection('The custom fields a company defines on employee profiles. Document id = companyId. Shape: shared/customFields.ts.', defineSchema({ ...tenant, defs: [Mixed], updatedBy: String, updatedAt: String })),
  customFieldValues: collection('One person\'s custom field values. Document id = companyId__uid.', defineSchema({ ...tenant, uid: reqStr, values: Mixed, updatedBy: String, updatedAt: String })),
  savedReports: collection('A saved report definition (dataset, columns, filters, sort, grouping). Shape: shared/reportBuilder.ts.', defineSchema({ ...tenant, id: String, name: reqStr, def: Mixed, shared: Boolean, createdBy: String, createdByName: String, createdAt: String, updatedAt: String })),
  approvalChains: collection('An approval chain for a kind of request: ordered steps (manager, skip-level or named people), an optional minimum amount, fallback approvers.', defineSchema({ ...tenant, id: String, name: reqStr, kind: reqStr, minAmount: Number, active: Boolean, steps: [Mixed], fallbackUids: [String], updatedAt: String, updatedBy: String })),
  approvalRequests: collection(
    'A request moving through an approval chain. Approvers are fixed per step when it is sent. Status PENDING, APPROVED, REJECTED, CANCELLED.',
    defineSchema({ ...tenant, id: String, chainId: String, chainName: String, kind: reqStr, title: reqStr, details: String, amount: Number, requesterUid: reqStr, requesterName: String, status: oneOf(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']), current: Number, steps: [Mixed], history: [Mixed], createdAt: String }),
  ),
};
