/** Companies, people, roles and the records every module shares. */
import { collection, defineSchema, oneOf, reqStr, reqBool, stamps, tenant, Mixed } from './helpers.js';

const PORTALS = ['CREATOR', 'REVIEWER', 'EMPLOYEE'] as const;

export const core = {
  companies: collection(
    'One record per company (tenant). A new company is PENDING until a platform admin approves it.',
    defineSchema({
      id: String,
      name: reqStr,
      slug: String,
      status: oneOf(['PENDING', 'ACTIVE', 'SUSPENDED'], true),
      modules: [String],
      plan: String,
      adminEmail: String,
      employeeIdPrefix: String,
      nextEmployeeNumber: Number,
      accountId: String, // the account (customer) this organisation belongs to; see accounts.ts
      approvedAt: String,
      approvedBy: String,
      ...stamps,
    }, [[{ accountId: 1 }, { sparse: true }]]),
  ),

  departments: collection(
    'Departments of a company. `headUserId` is the employee id of the department head.',
    defineSchema({ id: String, ...tenant, name: reqStr, headUserId: String, ...stamps }, [[{ companyId: 1, name: 1 }]]),
  ),

  roles: collection(
    'Company roles: a named set of permission keys (see shared/permissions.ts). `portal` is the screen set the holder lands in.',
    defineSchema({
      id: String,
      ...tenant,
      name: reqStr,
      description: String,
      permissions: [String],
      portal: oneOf(PORTALS, true),
      isAdmin: Boolean,
      isDefault: Boolean,
      ...stamps,
    }),
  ),

  employees: collection(
    'One record per person who can sign in. `id` equals the Firebase Auth uid. Effective permissions come from the roles, and the token claims are the source of truth.',
    defineSchema(
      {
        id: String,
        authUid: String,
        ...tenant,
        companyName: String,
        empId: String,
        loginId: String,
        name: reqStr,
        email: reqStr,
        title: String,
        departmentId: String,
        departmentName: String,
        roleIds: [String],
        roleNames: [String],
        role: oneOf(PORTALS),
        perms: [String],
        authorizedModules: Mixed, // 'ALL' or a list of module keys
        active: reqBool,
        avatar: String,
        ...stamps,
      },
      [
        [{ companyId: 1, email: 1 }],
        [{ authUid: 1 }, { sparse: true }],
        [{ companyId: 1, departmentId: 1 }],
        [{ companyId: 1, roleIds: 1 }],
      ],
    ),
  ),

  counters: collection('Running numbers (employee ids, document ids, requisition numbers). One document per counter.', defineSchema({ companyId: String, value: Number })),

  platformAudit: collection('Platform-admin actions (company approval, landing-page edits).', defineSchema({ action: String, by: String, at: String, detail: Mixed })),

  profilePhotos: collection('Employee profile photos as small data URLs. Document id = employee id.', defineSchema({ companyId: String, dataUrl: String, updatedAt: String })),

  userActivity: collection(
    'When each signed-in person was last seen (one record per person, written at most hourly). Feeds the Founders Dashboard counts. Never read by the browser.',
    defineSchema({ uid: reqStr, companyId: reqStr, firstSeenAt: String, lastSeenAt: String }),
  ),
};
