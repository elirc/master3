# Feature Plan: Initial Operational Core

## Goal

Create the first usable version of the support desk: tenant-scoped customer data, ticket queue, ticket detail workflow, internal/public comments, SLA tracking, email ingestion, outbox worker, audit logs, seed data, and frontend screens.

## Impacted Areas

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `packages/domain`
- `packages/shared`
- `apps/api`
- `apps/web`
- `apps/worker`
- `tests/domain`

## Implementation Approach

1. Model the core support entities in Prisma.
2. Put workflow rules in `packages/domain`.
3. Put validation schemas in `packages/shared`.
4. Build thin Express routes that call service functions.
5. Use transactions for ticket changes, audit logs, and outbox events.
6. Build a dense React workspace around the queue and ticket detail.
7. Add tests for domain rules before database integration tests.

## Design Considerations

The system should feel production-shaped without pretending to be production-complete. Header-based demo auth is acceptable for the first slice because it keeps attention on tenant isolation and authorization patterns. The outbox worker is intentionally simple, but the table and processing lifecycle are realistic.

## Build Journal

### What Was Built

The repo now has a TypeScript monorepo-style layout with an Express API, React/Vite frontend, Prisma/PostgreSQL schema, worker process, domain package, shared validation schemas, tests, Docker Compose, CI, and documentation.

### How It Connects

The frontend calls `/api` endpoints with tenant/user headers. The auth middleware resolves the current actor. Ticket services enforce domain transitions, write audit logs, and enqueue outbox events. The worker polls outbox events and marks them processed.

### Lessons For A Growing Developer

Business rules should be easy to find and test. A route handler should not be the only place where a workflow rule exists. Also, important side effects should be transactionally connected to the write that caused them, which is why audit logs and outbox events are created with ticket updates.

### Tradeoffs And Future Improvements

The first version does not include real login, refresh tokens, full-text search, real email delivery, or a queueing library. Those are good future features once the basic module boundaries are stable.
