/**
 * Accounts and multi-organisation. An account is the customer who buys a plan; it owns one or more organisations
 * (the `companies` records). People can be transferred between the organisations of one account.
 * Account-level records have no `companyId`: they belong to the account, not to one organisation.
 */
import { collection, defineSchema, oneOf, reqNum, reqStr, Mixed } from './helpers.js';

export const accounts = {
  accounts: collection(
    'The customer account. Id is `acc_<first companyId>`. Plan, modules and the organisation limit set here apply to every organisation of the account. `groupAdminUids` may switch between organisations and act as administrator in each.',
    defineSchema({
      id: String,
      name: reqStr,
      ownerEmail: String,
      orgLimit: reqNum, // how many organisations the account may hold
      plan: String,
      modules: [String],
      groupAdminUids: [String],
      createdAt: String,
      updatedAt: String,
    }),
  ),

  accountAudit: collection(
    'Audit trail of account-level actions (organisation created, people transferred).',
    defineSchema({ accountId: reqStr, action: reqStr, by: String, at: String, companyId: String, to: String, requested: Number, moved: Number, copiedFrom: String }, [[{ accountId: 1, at: -1 }]]),
  ),

  employmentHistory: collection(
    'One record per transfer of a person between organisations: old and new employee code, effective date, and what was carried over. The person keeps the same `uid` (Firebase login) across organisations.',
    defineSchema(
      {
        id: String,
        accountId: reqStr,
        uid: reqStr,
        name: String,
        fromCompanyId: reqStr,
        fromCompanyName: String,
        fromEmpId: String,
        toCompanyId: reqStr,
        toCompanyName: String,
        toEmpId: String,
        effectiveDate: String, // YYYY-MM-DD
        transferredBy: String,
        carried: Mixed, // what moved with the person (leave balances, profile, identity files ...)
        note: String,
        at: String,
      },
      [[{ uid: 1 }], [{ accountId: 1 }]],
    ),
  ),

  transferRequests: collection(
    'A proposed transfer waiting for the other side to approve. `input` is the TransferInput of api/_lib/orgTransfer.ts.',
    defineSchema(
      {
        id: String,
        accountId: reqStr,
        fromCompanyId: reqStr,
        fromCompanyName: String,
        toCompanyName: String,
        input: Mixed,
        status: String,
        proposedBy: String,
        proposedByUid: String,
        createdAt: String,
      },
      [[{ accountId: 1 }], [{ fromCompanyId: 1 }]],
    ),
  ),
};
