# Master3 CRUD upskill path

This course follows one support ticket from an HTTP request to a tenant-scoped database row and back to a response. The project ("support-desk-crm" in `package.json`) is a TypeScript modular monolith: Express 4 routes parse input with Zod, a service applies business rules, Prisma 5 writes PostgreSQL 16 (from `docker-compose.yml`), a polling worker drains outbox rows, and a React 18 + Vite 6 single page drives it all. There is one root `package.json`; `@support/domain` and `@support/shared` are not npm workspaces but path aliases in `tsconfig.json` and `vitest.config.ts`.

Identity is a demo fixture. `x-tenant-slug` and `x-user-email` are looked up in [auth.ts](../apps/api/src/middleware/auth.ts) with no credential check, and both default to seeded values (`auth.ts:20-21`). The web app even ships a user switcher (`apps/web/src/App.tsx:18`, `:150`). Treat everything below as "authorization given an honest identity"; [06](06-SOLUTIONS-AND-REVIEW.md) shows what an attacker does with the fixture.

## Reading order

1. [01-CODEBASE-MAP.md](01-CODEBASE-MAP.md): files, sizes, and the request pipeline with line numbers.
2. [02-CONCEPTS.md](02-CONCEPTS.md): tenant scope, the role gate, response shaping, transactions and the serializable retry.
3. [03-WORKED-CHANGE.md](03-WORKED-CHANGE.md): the ticket PATCH repair, diffed against the snapshots in `snapshots/`.
4. [04-TESTING-AND-DEBUGGING.md](04-TESTING-AND-DEBUGGING.md): what the 17 unit tests and the 2 opt-in integration tests prove, and what they do not.
5. [05-PRACTICE.md](05-PRACTICE.md): seven Goal + **Check** exercises, each checked with dependency-free `node --test`.
6. [06-SOLUTIONS-AND-REVIEW.md](06-SOLUTIONS-AND-REVIEW.md): answers, then a senior review of defects the course does not fix.
7. [07-TRACE-LAB.md](07-TRACE-LAB.md): six request traces, including two that end in a 500.
8. [VERIFICATION.md](VERIFICATION.md): the recorded verify run and how to repeat it.

The central lesson: authorization and response shaping are enforced at the service boundary. A viewer PATCH fails before the database lookup; an agent PATCH succeeds and returns internal notes; the same comment-visibility rule applies to the ticket returned by a write as to the ticket returned by a read. Every accepted ticket mutation writes its audit and outbox rows in the same Prisma transaction.

## Prerequisites and glossary

**Prerequisites:** TypeScript and Express handlers; enough Prisma for a `where`, an `include` and a `$transaction`; the difference between 401, 403 and 404.

| term | meaning | where in this project |
| --- | --- | --- |
| auth context | tenant id, user id, role and email resolved from demo headers | `authMiddleware`, `apps/api/src/middleware/auth.ts:19-41` |
| tenant scope | the tenant id in every lookup, so a foreign id still misses | `where: { id, tenantId: auth.tenantId }`, `ticketService.ts:107`, `:177` |
| role gate | the check that must fail before the database is touched | `canEditTicket`, `packages/domain/src/index.ts:83-85`; called at `ticketService.ts:172` |
| response policy | role decides which comments a returned ticket carries, on PATCH as on GET | `visibleCommentWhere` / `ticketIncludeForRole`, `ticketService.ts:43-56` |
| transition guard | which status change this role may make | `canTransitionTicket` / `assertTicketTransition`, `packages/domain/src/index.ts:32-43` |
| audit row | who changed what, written in the same transaction | `tx.auditLog.create`, `ticketService.ts:216-225` |
| outbox event | the intent to notify, committed with the write rather than sent | `tx.outboxEvent.create`, `ticketService.ts:227-233` |
| outbox drain | the worker poll that marks events PROCESSING then PROCESSED | `processOutboxBatch`, `apps/worker/src/worker.ts:6-34` |
| serializable retry | re-run the whole transaction when PostgreSQL reports `P2034` | `withSerializableRetry`, `ticketService.ts:22-31` |
| SLA state | deadline status derived on the way out, never stored | `getSlaState`, `packages/domain/src/index.ts:56-68`, applied by `enrichTicket` at `ticketService.ts:58-67` |
