# System Design Summary

## Repo Structure

- `apps/api`: Express API for tenant-scoped product workflows
- `apps/web`: React frontend for support agents, managers, and admins
- `apps/worker`: background outbox consumer
- `packages/domain`: framework-independent business rules
- `packages/shared`: validation schemas and DTO types
- `prisma`: PostgreSQL schema and seed data
- `docs`: architecture plan, journal, feature plans, backlog, and walkthroughs
- `tests`: domain-level verification

## Major Module Connections

The frontend calls API endpoints through `apps/web/src/lib/api.ts`. The API resolves a demo actor in auth middleware, then route modules call service functions. Services use Prisma to read/write tenant-scoped data and domain helpers to enforce ticket rules. Important writes create audit logs and outbox events. The worker processes pending outbox events.

## Key Workflows

- Ticket queue: filter tickets, select a ticket, inspect customer/company context.
- Ticket update: validate input, enforce transition and assignment rules, update record, audit, emit outbox event.
- Commenting: create internal notes or public replies; public replies set first response time and emit notification events.
- Email ingestion: receive inbound email, upsert customer, create ticket, store email, emit integration event.
- Audit review: managers/admins inspect recent actions.

## Design Decisions

- Modular monolith over microservices to keep learning focused on boundaries inside one codebase.
- Domain package for reusable business rules.
- Zod schemas for API input validation.
- Prisma schema with tenant IDs on operational tables.
- Outbox pattern from the first version because notifications and integrations are realistic support-desk concerns.
- Dense frontend UI because internal tools are used repeatedly by trained users.

## Tradeoffs

- Header-based demo auth is intentionally temporary.
- Polling worker is simpler than a real queue.
- Search is database filtering, not full-text search.
- Tests currently focus on domain rules instead of database-backed integration.
- The frontend is a single app component to keep the first walkthrough approachable; it should be split as more features land.

## Improvements

Next good engineering exercises:

- Replace demo auth with a real provider.
- Add integration tests with a test database.
- Add saved views and automation rules.
- Add file attachments and object storage.
- Add webhooks with retry policies.
- Add cursor pagination and full-text search.
- Split the main React app into workflow-specific components.
- Add structured logging, metrics, and trace IDs.
