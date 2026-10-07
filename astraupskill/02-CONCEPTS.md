# Concepts: tenant-safe CRUD

## Authentication and authorization are two decisions

**Predict before you read on:** a viewer sends a PATCH with only `priority`; which layer refuses it, and what has been read from the database by then?

`authMiddleware` answers "who is this?" by finding an active user in the tenant named by `x-tenant-slug` (`auth.ts:23-26`). It does not decide what that user may do. The role then supplies the second decision: `VIEWER` may read tickets, see public comments and post public comments; `ADMIN`, `MANAGER` and `AGENT` may edit tickets (`packages/domain/src/index.ts:83-85`). `updateTicket` calls `canEditTicket` on its first line (`ticketService.ts:172`), so the answer to the prediction is: the service refuses it, after only the auth lookup of the user row. Because the check is in the service rather than the route, it also holds for a test, a script or a future worker that calls `updateTicket` directly.

The weak half is the first decision. The email header is an unverified claim and the role comes from whichever row that email selects, so a caller who knows `admin@acme.test` is an admin. Production would put a session or token check in front of `authMiddleware`; everything after it stays the same.

## Tenant scope is part of every lookup

**Predict before you read on:** a valid ticket id from tenant B is used with a tenant A agent session; 403, 404 or 200?

404. `where: { id, tenantId: auth.tenantId }` (`ticketService.ts:177`) makes a foreign id behave like a missing one, so the response does not reveal that the id exists elsewhere. The same predicate guards the customer in `createTicket` (`:116-120`), the assignee in `updateTicket` (`:192-195`) and the ticket in `addTicketComment` (`:244-248`). The schema has no row-level security; the service is the only thing selecting the right tenant. The opt-in integration test pins this case (`tests/integration/ticket-patch.int.test.ts:68-73`).

One subtlety: the write itself is `tx.ticket.update({ where: { id } })` (`ticketService.ts:200-201`) with no tenant predicate. It is safe only because the tenant-scoped read at `:176` ran first in the same request.

## Comment visibility is response policy

**Predict before you read on:** before the repair, which of GET and PATCH returned the internal note to a viewer, and why did they differ?

`visibleCommentWhere("VIEWER")` returns `{ visibility: "PUBLIC" }`; every other role gets `{}` (`ticketService.ts:43-45`). In the original code (`snapshots/ticketService-before.ts.txt`) `getTicket` built that filter inline, while `updateTicket` returned `include: ticketInclude`, the unfiltered shape. So GET hid the note and the PATCH response carried it. `ticketIncludeForRole` (`:47-56`) now feeds both call sites (`:108`, `:213`). The general rule: every endpoint that returns a ticket is a read path, including the ones whose verb is a write.

## Accepted writes are one transaction

**Predict before you read on:** the outbox insert fails after the ticket update; what does the client see, and does the audit row exist?

The client sees a 500 (the Prisma error is not an `HttpError`, `errors.ts:32-33`) and no audit row exists: the ticket update, the audit insert and the outbox insert are in one `prisma.$transaction` callback (`ticketService.ts:199-236`), so they commit together or not at all. The outbox row is a durable promise to notify. Nothing external is sent until the worker reads a committed row, which means a rolled-back change can never have announced itself.

## Serializable means "retry", or it means nothing

`Serializable` lets PostgreSQL refuse a commit whose result could not have come from some serial order of the concurrent transactions. The refusal is SQLSTATE `40001`, which Prisma reports as `P2034`, and the contract is that the application retries. `withSerializableRetry` (`ticketService.ts:22-31`) re-runs the whole callback up to three times on `P2034` and on nothing else: an `HttpError` is a decision, not contention, and a `P2002` unique violation will not disappear on retry. `tests/api/ticket-service.test.ts:129-150` pins all three behaviours.

Note what the isolation level does **not** cover. In `updateTicket` the ticket is read at `:176` and the transition validated at `:183-185`, both before the transaction opens at `:199`. Serializable protects the reads made inside the transaction, and the transaction makes none. Exercise 6 and finding F3 in [06](06-SOLUTIONS-AND-REVIEW.md) follow this through.

**Predict:** if the callback has already created an audit row when the serialization failure arrives, how many audit rows exist after a successful retry? (One: the failed attempt rolled back with its transaction.)

## SLA state is derived, not stored

`calculateSlaDueAt` adds 120, 480, 1440 or 4320 minutes for URGENT, HIGH, NORMAL, LOW (`packages/domain/src/index.ts:45-54`). `getSlaState` (`:56-68`) returns `PAUSED` for PENDING, RESOLVED and CLOSED, `MET` when there is no due date, `BREACHED` when the deadline has passed, and `AT_RISK` within the last hour, inclusive of exactly 60 minutes and of exactly zero. Only `slaDueAt` is stored; the state is recomputed on every response. "Paused" is therefore only a label: the stored deadline does not move while a ticket waits on the customer (exercise 2).
