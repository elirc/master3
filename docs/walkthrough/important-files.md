# Important File Walkthrough

## `prisma/schema.prisma`

This is the product data model. Read it first to understand the nouns in the system: tenants, users, companies, customers, tickets, comments, email messages, audit logs, and outbox events. Notice that tenant isolation is not implied; it is represented by `tenantId` on operational tables.

Important sections:

- Enums define workflow vocabulary.
- `Ticket` connects customer, assignee, comments, email messages, SLA fields, tags, and status.
- `AuditLog` and `OutboxEvent` show operational concerns that are not directly visible in the UI but matter for maintenance.

Senior concept: schema design is product design. A hard-to-query schema becomes a hard-to-change product.

## `packages/domain/src/index.ts`

This file holds business rules that should survive framework changes. Ticket transitions, SLA due-date math, SLA state, and basic permission helpers live here.

Read this file before changing ticket behavior. If a rule is important enough to affect multiple modules, it probably belongs here or in a nearby domain helper.

Senior concept: keeping domain rules framework-free makes them easy to test and harder to accidentally bypass.

## `packages/shared/src/index.ts`

This file defines Zod schemas for API inputs. The schemas produce TypeScript types, so validation and DTO typing stay connected.

Senior concept: validation belongs at boundaries. The API should convert unknown request data into known application data before service logic runs.

## `apps/api/src/middleware/auth.ts`

This middleware creates the request auth context. In this learning version it uses demo headers, but the rest of the app treats the result like a real authenticated actor.

Important habit: downstream modules should use `req.auth.tenantId`; they should not rediscover tenancy on their own.

## `apps/api/src/modules/tickets/ticketService.ts`

This is the main orchestration file. It lists tickets, reads ticket details, creates tickets, updates tickets, and adds comments.

Important sections:

- `listTickets` builds the query shape from validated filters.
- `createTicket` uses a transaction to create the ticket, audit log, and outbox event.
- `updateTicket` rejects non-operational roles with `canEditTicket` before any lookup, then checks domain transitions and assignment permissions before writing.
- `addTicketComment` distinguishes public replies from internal notes and emits notification events for public replies.

Senior concept: orchestration code coordinates rules, persistence, and side effects. It should be explicit and boring.

## `apps/api/src/modules/notifications/notificationRoutes.ts`

This route simulates inbound email ingestion. It upserts a customer, creates a ticket, stores the email message, and emits an outbox event.

Senior concept: integrations should preserve source data. Storing the inbound email separately from the ticket gives future debugging and reprocessing options.

## `apps/worker/src/worker.ts`

The worker consumes outbox events. It is intentionally small, but it demonstrates a separate runtime reading durable background work from the database.

Senior concept: background jobs are part of the system design, not an afterthought. They need state, retries, and observability as the system grows.

## `apps/web/src/App.tsx`

This is the main frontend workflow surface. It fetches queue data, selects tickets, updates status/priority/assignment, adds comments, creates tickets, and switches to customer/audit views.

Read it by following user workflows rather than top-to-bottom:

- `refresh`
- `selectTicket`
- `updateSelectedTicket`
- `submitComment`
- `submitTicket`
- `simulateInboundEmail`

Senior concept: frontend state should model workflows. A dense internal UI should optimize repeated operational tasks, not present a decorative landing page.

## `apps/web/src/lib/api.ts`

This file is the frontend's API boundary. It centralizes request headers, response types, and endpoint functions.

Senior concept: isolating API calls keeps components focused on workflow and rendering. It also gives you one place to evolve auth headers or error handling.

## `tests/domain/ticket-rules.test.ts`

These tests protect the highest-value pure rules: transitions, SLA state, and authorization helpers.

Senior concept: start tests where bugs are expensive and setup is cheap. Domain tests are fast, stable, and clarify expected behavior.
