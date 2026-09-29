# Feature Backlog

This backlog is intentionally product-shaped. Some items are implemented in the initial build, while later phases are designed to create realistic maintenance pressure.

## Phase 1 - Initial Operational Core

- Tenant-scoped data model
- Demo authentication context
- Role-based access control helpers
- Customers, companies, and contacts
- Ticket queue with search/filtering/pagination shape
- Ticket status, priority, assignment, and tags
- Internal notes vs public replies
- SLA due date and SLA state calculation
- Inbound email ingestion
- Outbox pattern and worker
- Audit logs
- Seed data
- Frontend queue, ticket detail, customer, and audit screens
- CI/typecheck/test/build scripts

## Phase 2 - Workflow Depth

- Saved views
- Automation rules
- Escalation policies
- Approval workflows for sensitive replies
- Team inbox ownership
- Collision indicators when multiple agents work the same ticket

## Phase 3 - Platform Capabilities

- Real authentication provider
- Fine-grained permissions
- Webhooks
- Public API contracts
- CSV import/export
- File uploads and object storage
- Knowledge base
- Customer portal

## Phase 4 - Operations and Insight

- Reporting dashboards
- Team performance analytics
- Observability and structured logging
- Health checks beyond database reachability
- Data retention controls
- Compliance exports
- Billing or usage tracking if the product becomes multi-tenant SaaS

## Build Status

The initial pass implements Phase 1. Later phases are deliberately documented as future expansion because they are valuable learning exercises that build on the same module boundaries.
