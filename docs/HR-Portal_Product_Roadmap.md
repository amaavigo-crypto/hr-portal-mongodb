# HR Portal — Product Roadmap

**Baseline:** `main` branch inspected 19 November 2026  
**Purpose:** Separate capabilities already described as implemented from documented gaps and proposed future direction.  
**Planning note:** This is a strategic roadmap, not a promise of delivery dates. Priorities should be validated against customer needs, legal requirements, security review and engineering capacity.

## 1. Product vision

Build a connected people-operations platform that helps companies manage the full employee lifecycle—from workforce planning and recruitment through daily operations, performance, development and retention—without fragmenting work across disconnected tools.

## 2. Current product baseline

The following capabilities are documented in the current main branch.

| Product area | Current baseline |
|---|---|
| Tenant and access foundation | Company registration/approval, tenant context, Firebase authentication, custom claims, role templates and permission checks |
| People operations | Employee records, Employee 360, Home, announcements and acknowledgements |
| Leave and attendance | Leave policies and ledger, approvals, web attendance, regularization, reports and flags |
| Talent Acquisition | Requisitions, budgets, JD library, candidate scoring, screening, assessments, interviews and feedback |
| Hiring automation | Configurable, versioned hiring flows, routing, candidate tasks, automated skills tests and exception handling |
| Offers and onboarding | Offer packs and approvals, candidate response, joining checklist, asset register and IT setup tracking |
| HRBP | Headcount planning, talent review, 9-box, KPI governance, PIPs, pulse surveys, recognition, wellness, learning and succession |
| Performance | KPI/behaviour/SOP framework, plans, evidence, check-ins, quarterly reviews and development plans |
| Tasks | My Tasks, boards, projects, review workflow, KPI evidence linkage and reminders |
| Wellbeing | Consent-based games, server-side scoring, privacy thresholds and audited individual views |
| Ask HR | Read-only personal HR and policy assistant |
| Platform site | Editable landing-page content and SEO metadata |

## 3. Known gaps in the current version

These are explicitly documented limitations or unfinished areas, not assumed future commitments:

- Payroll is not yet integrated with leave and attendance calculations.
- Hourly leave and leave years anchored to each employee's joining date are not built.
- Biometric-dependent attendance reports and employee-specific biometric shift changes are unavailable.
- Help Desk, Survey and dependent files are not built in the documented Home scope.
- True Google/Microsoft calendar synchronization is not built; interview invitations use `.ics`.
- WhatsApp interview reminders are not built; optional WhatsApp reminders elsewhere depend on configuration.
- Task recurrence, dependencies, custom project statuses and separate sub-task entities are not built.
- Email uses one shared SMTP account across companies.
- Existing tenants may need newly introduced permissions assigned to their roles.
- Some legacy records and file links require migration/backfill work.

## 4. Strategic roadmap themes

### Theme A — Complete the HR operations foundation

**Objective:** Close the gaps that create manual reconciliation or operational risk.

Candidate initiatives:
- Define and implement the leave/attendance-to-payroll integration boundary, including approvals, cut-off periods, corrections and reconciliation.
- Evaluate hourly leave and joining-date-based leave policies against customer and jurisdiction requirements.
- Add integrations for biometric devices only after defining supported vendors, data contracts and exception handling.
- Complete the documented employee self-service gaps such as Help Desk, surveys and dependent records.
- Improve tenant-specific email sender configuration and delivery observability.

**Success measures:** fewer manual reconciliations, fewer payroll exceptions, lower correction turnaround time and reliable audit trails.

### Theme B — Deeper integrations and automation

**Objective:** Reduce duplicate data entry and make workflows work with the systems companies already use.

Candidate initiatives:
- Real calendar integrations for interview scheduling and rescheduling.
- Reliable WhatsApp and email notification preferences, templates, delivery status and opt-out handling.
- More robust connectors for Microsoft 365 / Google Workspace and common HR/payroll systems.
- Webhook and API documentation for customer-owned integrations.
- Central integration health, retry and failure visibility for administrators.

**Success measures:** successful sync rate, reduced manual handoffs, notification delivery and lower integration support effort.

### Theme C — Workforce intelligence and decision support

**Objective:** Turn structured operational data into useful, explainable leadership insight.

Candidate initiatives:
- Cross-module workforce dashboards connecting headcount, hiring pipeline, onboarding, leave, attendance, performance and attrition.
- Configurable metric definitions and data freshness indicators.
- Trend analysis with clear source data and drill-down permissions.
- Explainable anomaly detection and HR review queues.
- Better scenario planning for headcount, hiring demand and capacity.

**Guardrails:** aggregate views should respect minimum group sizes; individual records remain permission-gated; AI should explain and summarize rather than make employment decisions.

### Theme D — Employee experience and self-service

**Objective:** Make common employee actions simple across desktop and mobile.

Candidate initiatives:
- Consistent responsive experience for employee and manager workflows.
- Unified notifications and a personal action centre.
- Guided onboarding and policy acknowledgement journeys.
- Search across permitted policies, documents and personal HR records.
- Expanded Ask HR coverage only where authoritative data and access controls exist.
- Accessibility and localization improvements.

**Success measures:** self-service completion, fewer HR queries for routine matters, task completion time and employee satisfaction.

### Theme E — Configurable lifecycle and talent development

**Objective:** Give companies flexible workflows without sacrificing governance.

Candidate initiatives:
- Extend workflow configuration patterns beyond recruitment where customer demand supports it.
- Richer onboarding templates and conditional checklists.
- Skills and competency frameworks linked to role profiles, learning paths and development plans.
- Succession-readiness workflows and structured career pathways.
- More configurable performance cycles and evidence sources.

**Guardrails:** version configurations, preserve historical snapshots, require approval for sensitive transitions and prevent self-approval.

### Theme F — Platform maturity, security and scale

**Objective:** Make the multi-tenant platform reliable to operate and safe to expand.

Candidate initiatives:
- Formal tenant-isolation test suite and recurring authorization reviews.
- Database backup/restore drills, migration verification and retention policies.
- Centralized job monitoring, retries, dead-letter visibility and idempotency checks.
- Audit export and configurable retention.
- Observability for API latency, error rates, scheduled jobs, AI usage and email delivery.
- Review function-count limits and hosting architecture as module usage grows.
- Documented disaster recovery and incident response procedures.

## 5. Prioritization sequence

This is a suggested order, not a committed schedule.

| Horizon | Focus | Candidate outcomes |
|---|---|---|
| **P0 — Foundation and risk** | Security, tenant isolation, data integrity, backups, operational monitoring | Confidence in tenant boundaries, recovery and scheduled automation |
| **P1 — Close operational gaps** | Payroll boundary, leave policy gaps, email delivery and employee self-service | Less manual HR reconciliation and fewer process gaps |
| **P2 — Connected ecosystem** | Calendar, messaging, Microsoft/Google and customer APIs | Fewer disconnected workflows and more reliable integrations |
| **P3 — Intelligence and experience** | Workforce analytics, action centre, mobile experience, explainable insights | Faster decisions and simpler employee/manager journeys |
| **P4 — Advanced lifecycle** | Extended workflow builder, skills, learning and succession | More configurable and development-oriented people operations |

## 6. Cross-cutting product principles

1. **Tenant isolation first:** all new data and APIs must enforce company scope on the server.
2. **Least privilege:** individual employee information is exposed only to roles with a clear business need.
3. **Privacy by design:** collect only necessary information, explain use, support retention/deletion and suppress small groups where appropriate.
4. **Human accountability:** employment decisions, approvals and sensitive actions remain with authorized people.
5. **AI with guardrails:** use AI for drafting, summarization and assistive analysis; do not let it invent facts, override permissions or independently determine employment outcomes.
6. **Auditability:** important changes, approvals, individual access and automated transitions should be traceable.
7. **Idempotent automation:** retries must not duplicate leave accruals, reminders, approvals or workflow transitions.
8. **Mobile-ready workflows:** core employee and manager actions should remain usable on smaller screens.
9. **Integration resilience:** external service failures should be visible, retryable and should not corrupt core HR records.
10. **Evidence-led metrics:** dashboards should expose definitions, sources, freshness and limitations.

## 7. Dependencies and decisions to resolve

Before committing roadmap dates, validate:

- Which payroll systems and statutory jurisdictions must be supported.
- Which biometric vendors are used by target customers.
- Whether each tenant requires its own email provider or sender domain.
- Priority calendar and messaging providers and their authorization model.
- Data retention, deletion and employee consent requirements by jurisdiction.
- Whether the platform should support customer-managed data exports and audit retention.
- Expected tenant count, employee volume, API traffic and database growth.
- Which analytics are safe to aggregate and which require additional consent or access controls.

## 8. Suggested release acceptance checklist

A roadmap item should not be considered complete until it has:

- Tenant-isolation and permission tests.
- Audit and privacy behaviour defined for sensitive data.
- Idempotent retry behaviour for automation.
- Failure, timeout and recovery paths for integrations.
- Migration/backfill plan where existing data is affected.
- Responsive UI and accessibility review.
- Updated technical documentation and user-facing help.
- Observability and support runbook.
- Explicit distinction between enabled, optional and unavailable functionality.

## 9. What success looks like

The platform should progressively move from a collection of capable HR modules to a genuinely connected operating system for people operations: one employee record, coherent workflows, reliable integrations, actionable workforce insight and a simple employee experience—while preserving privacy, tenant boundaries and human decision-making.
