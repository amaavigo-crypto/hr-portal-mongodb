/** Employee Master: personal data, identity documents, family and qualifications (all server-only). */
import { collection, defineSchema, tenant, reqStr, Mixed } from './helpers.js';

const byUid = [[{ companyId: 1, uid: 1 }]] as [Record<string, 1>][];

export const employee = {
  employeeProfiles: collection('Employment details of a person (joining, designation, reporting, status). Document id = employee uid.', defineSchema({ ...tenant, uid: String, photo: String, updatedAt: String, updatedBy: String }, byUid)),
  employeePersonal: collection('Personal information fields (general, contact, emergency); the field list is in shared/employeePersonal.ts.', defineSchema({ ...tenant, uid: String, updatedAt: String }, byUid)),
  employeeIdentities: collection('Identity document numbers (PAN, Aadhaar, passport ...), masked until revealed.', defineSchema({ ...tenant, uid: reqStr, updatedAt: String }, byUid)),
  employeeIdentityData: collection('Image data of identity documents (kept apart from the numbers).', defineSchema({ ...tenant, uid: String, dataUrl: String })),
  employeeIdentityFiles: collection('Metadata for each uploaded identity document.', defineSchema({ ...tenant, uid: String, name: String, updatedAt: String }, byUid)),
  employeeFamily: collection('Family members and dependents of a person.', defineSchema({ ...tenant, uid: reqStr, members: [Mixed], updatedAt: String }, byUid)),
  employeeQualifications: collection('Qualification entries; the certificate image lives in employeeQualificationData.', defineSchema({ ...tenant, uid: reqStr, hasDocument: Boolean, docKb: Number, updatedAt: String, updatedBy: String }, byUid)),
  employeeQualificationData: collection('Certificate images (data URLs) for qualifications.', defineSchema({ ...tenant, uid: String, dataUrl: String })),
};
