/** Document governance (policies, SOPs, versions, acknowledgements) and company-wide Home content. */
import { collection, defineSchema, oneOf, reqStr, stamps, tenant, Mixed } from './helpers.js';

const VERSION_STATUS = ['DRAFT', 'IN_REVIEW', 'REVISION_REQUIRED', 'REJECTED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED', 'WITHDRAWN', 'EXPIRED'] as const;

export const documents = {
  documents: collection(
    'Document master record (one per policy / SOP / form). The text and file of each revision live in `versions`.',
    defineSchema(
      {
        id: String,
        documentId: String, // human code, e.g. AMA-HR-POL-001
        title: reqStr,
        category: String,
        ...tenant,
        companyName: String,
        departmentId: String,
        departmentName: String,
        processOwnerId: String,
        processOwnerName: String,
        documentOwnerId: String,
        documentOwnerName: String,
        confidentiality: String,
        acknowledgementRequired: Boolean,
        currentPublishedVersionId: String,
        currentPublishedVersionNumber: String,
        currentStatus: oneOf(VERSION_STATUS),
        description: String,
        createdById: String,
        createdByName: String,
        active: Boolean,
        ...stamps,
      },
      [[{ companyId: 1, documentId: 1 }]],
    ),
  ),

  versions: collection(
    'One revision of a document (draft, in review, published ...). Holds the extracted text (`rawContent`) and where the file is stored.',
    defineSchema(
      {
        id: String,
        ...tenant,
        documentMasterId: String,
        documentId: String,
        documentTitle: String,
        versionNumber: String, // "1.0", "1.1", "2.0"
        versionType: oneOf(['INITIAL', 'MINOR', 'MAJOR']),
        status: oneOf(VERSION_STATUS),
        fileName: String,
        fileSize: Number,
        mimeType: String,
        storageKey: String,
        storagePath: String,
        fileUrl: String,
        originalFileUrl: String,
        contentHash: String, // SHA-256 of the file
        rawContent: String,
        createdById: String,
        createdByName: String,
        createdAt: String,
        reviewedById: String,
        reviewedAt: String,
        reviewerComments: String,
        publishedById: String,
        publishedAt: String,
        effectiveFrom: String,
        effectiveTo: String,
        reviewDueDate: String,
        previousVersionId: String,
        supersededByVersionId: String,
        changeSummary: String,
        locked: Boolean,
        inlineComments: [Mixed],
      },
      [[{ companyId: 1, status: 1 }], [{ companyId: 1, documentMasterId: 1 }]],
    ),
  ),

  acknowledgments: collection(
    'Who must read / has acknowledged which published version of a document.',
    defineSchema(
      {
        id: String,
        ...tenant,
        documentId: String,
        documentTitle: String,
        versionNumber: String,
        documentVersionId: String,
        employeeId: reqStr,
        employeeName: String,
        employeeEmail: String,
        departmentName: String,
        status: oneOf(['PENDING', 'ACKNOWLEDGED']),
        acknowledgedAt: String,
        notes: String,
        reminderSentAt: String,
        offlineSignOff: Boolean,
        signOffType: oneOf(['ONLINE', 'OFFLINE']),
        recordedBy: String,
      },
      [[{ companyId: 1, employeeId: 1 }], [{ companyId: 1, status: 1 }]],
    ),
  ),

  auditLogs: collection('Append-only audit trail of document actions. Never edited by the browser.', defineSchema({ ...tenant, action: reqStr, performedById: String, performedAt: String, documentId: String, documentVersionId: String, oldValue: String, newValue: String })),

  documentSuggestions: collection(
    'Employee suggestions on a published policy and HR\'s review of them.',
    defineSchema({
      id: String,
      ...tenant,
      documentId: String,
      documentMasterId: String,
      employeeId: reqStr,
      category: String,
      subject: String,
      content: String,
      status: String,
      reviewNotes: String,
      reviewedById: String,
      reviewedAt: String,
      ...stamps,
    }),
  ),

  notifications: collection('In-app notifications for one person.', defineSchema({ ...tenant, userId: String, title: String, message: String, read: Boolean, createdAt: String })),

  announcements: collection(
    'Announcements and CEO-speak posts shown on Home. Empty `departmentIds` means everyone.',
    defineSchema(
      {
        id: String,
        ...tenant,
        kind: oneOf(['ANNOUNCEMENT', 'CEO_SPEAK'], true),
        title: reqStr,
        body: String,
        authorName: String,
        authorTitle: String,
        departmentIds: [String],
        pinned: Boolean,
        publishAt: String, // YYYY-MM-DD
        expireAt: String, // YYYY-MM-DD or empty
        active: Boolean,
        createdBy: String,
        ...stamps,
      },
      [[{ companyId: 1, kind: 1 }]],
    ),
  ),

  homeSettings: collection('Per-company Home configuration (quick links, quick reports, widgets). Document id = companyId.', defineSchema({ companyId: String, updatedAt: String })),
  moodCheckins: collection('Daily mood check-in, one per person per day. Only company-wide counts are ever shown.', defineSchema({ ...tenant, uid: reqStr, date: String, mood: oneOf(['UNHAPPY', 'SAD', 'OK', 'EXCITED', 'SATISFIED']) }, [[{ companyId: 1, uid: 1 }]])),
  loginDaily: collection('Sign-ins per day split web / mobile, for the Home login chart.', defineSchema({ ...tenant, date: String, web: Number, mobile: Number })),
  personalDates: collection('Birth and marriage dates, kept apart from the employee record on purpose. Document id = employee id.', defineSchema({ ...tenant, uid: String, birthDate: String, marriageDate: String, showMarriage: Boolean })),
  flagSettings: collection('Thresholds for payroll / late-mark / leave-pattern flags. Document id = companyId.', defineSchema({ companyId: String })),
};

