# Master3 CRUD upskill path

This course follows one support ticket from an HTTP request to a tenant-scoped database row and back to a response. The project is a TypeScript modular monolith: the Express route parses input, the service applies business rules, Prisma writes PostgreSQL records, and the worker later consumes outbox events. The code intentionally uses demo headers for local learning. `x-tenant-slug` and `x-user-email` are resolved by [auth.ts](../apps/api/src/middleware/auth.ts); they are a teaching fixture, not production authentication.

Read [01-CODEBASE-MAP.md](01-CODEBASE-MAP.md) first to identify route, service, domain, persistence, and worker boundaries. [02-CONCEPTS.md](02-CONCEPTS.md) explains tenant scope, role authorization, validation, and transaction boundaries. [03-WORKED-CHANGE.md](03-WORKED-CHANGE.md) walks the concrete PATCH repair. [04-TESTING-AND-DEBUGGING.md](04-TESTING-AND-DEBUGGING.md) turns the repair into evidence. Then complete the progressive exercises in [05-PRACTICE.md](05-PRACTICE.md), compare them with [06-SOLUTIONS-AND-REVIEW.md](06-SOLUTIONS-AND-REVIEW.md), and trace each request in [07-TRACE-LAB.md](07-TRACE-LAB.md). [VERIFICATION.md](VERIFICATION.md) records the command and its bounded limits.

The central lesson is to enforce authorization and response shaping at the service boundary. A viewer can read a ticket and see public comments, but a viewer PATCH must fail before the database lookup. An agent can update priority or tags and receives an operational response with internal comments. The same visibility rule must hold when the service returns an updated row, because filtering only GET responses creates a data leak on PATCH. Every accepted mutation writes its audit and outbox records inside the same Prisma transaction.

Use exact examples while studying: viewer `PATCH /api/tickets/t1` with `{ "priority": "URGENT" }` returns 403 and creates no audit or outbox row; agent PATCH returns 200; viewer GET returns a public comment and omits an internal note. Keep those observations in a ledger with actor, tenant, input, query, durable rows, response, and emitted event.

## Prerequisites and glossary

**Prerequisites:** TypeScript and Express handlers; enough Prisma for a `where`, an `include` and a `$transaction`; the difference between 401, 403 and 404. The `master2` course here is a natural predecessor.

| term | meaning | where in this project |
| --- | --- | --- |
| actor / auth context | the tenant and role resolved from demo headers before any handler | `authMiddleware` reading `x-tenant-slug` in `apps/api/src/middleware/auth.ts` |
| tenant scope | the tenant id in every lookup, so a foreign id still misses | `where: { id, tenantId: auth.tenantId }` in `apps/api/src/modules/tickets/ticketService.ts` |
| role gate | the check that must fail before the database is touched | `canEditTicket` and `canAssignTicket` in `packages/domain/src/index.ts` |
| response policy | visibility shapes what a response returns, on PATCH as well as GET | `visibleCommentWhere` and `ticketIncludeForRole` in `ticketService.ts` |
| comment visibility | the flag deciding whether a viewer ever sees a note | `visibility CommentVisibility` on `model TicketComment` in `prisma/schema.prisma` |
| transition guard | the domain rule for which status change this role may make | `canTransitionTicket` and `assertTicketTransition` in `packages/domain/src/index.ts` |
| audit row | who changed what, written in the same transaction | `tx.auditLog.create` in `updateTicket`, `model AuditLog` in `prisma/schema.prisma` |
| outbox event | the intent to notify, committed with the write rather than sent | `tx.outboxEvent.create` emitting `ticket.updated` in `ticketService.ts` |
| outbox drain | the worker pass claiming unprocessed events and stamping `processedAt` | `prisma.outboxEvent.findMany` in `apps/worker/src/worker.ts` |
| serializable transaction | the isolation level that stops concurrent updates interleaving silently | `Prisma.TransactionIsolationLevel.Serializable` in `ticketService.ts` |
| serialization failure retry | its required companion: catch the failure code and run the work again | `withSerializableRetry` and the `P2034` constant in `ticketService.ts` |
| SLA state | the deadline status derived on the way out, not stored on the row | `getSlaState` in `packages/domain/src/index.ts`, applied by `enrichTicket` |

