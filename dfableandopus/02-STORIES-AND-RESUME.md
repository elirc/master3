# Stories and resume material: Master3 support desk

## Story 1: an isolation level the code could not honour

**Situation.** `createTicket` and `updateTicket` both open `prisma.$transaction` with `Prisma.TransactionIsolationLevel.Serializable` (`apps/api/src/modules/tickets/ticketService.ts:165` and `:236`). Serializable is not a queue: when two transactions conflict, PostgreSQL aborts one with a serialization failure and expects the application to run it again.

**Task.** There was no retry anywhere, so the losing writer surfaced a 500 for a request that was entirely valid. Fix it without making the retry swallow anything it should not.

**Action.** I wrote `withSerializableRetry` (lines 22-31): a bounded loop of three attempts that rethrows immediately unless the error is a `PrismaClientKnownRequestError` with code P2034, so `HttpError` refusals, unique violations and everything else pass through untouched. Both serializable transactions now run inside it. I pinned the behaviour with three unit tests: first attempt fails and the second succeeds, asserting exactly two `$transaction` calls; three failures surface the P2034; and a P2002 is not retried, asserting exactly one call.

**Result.** 17 unit tests pass with `npx vitest run` and `npm run typecheck` exits 0. One thing worth telling on: during the change a scripted edit dropped `addTicketComment` out of the service file. I restored it from the stage copy, re-applied the wrapper by hand, and the typecheck is what proved the file was whole again, which is the argument for having a typecheck gate at all.

## Story 2: the response that leaked what the query had filtered

**Situation.** Viewers must never see `INTERNAL` comments. Reads honoured that. The object returned from a ticket PATCH did not, so a write response could carry an internal note that the same actor could not obtain with a GET.

**Task.** Make visibility a property of the response policy rather than of one endpoint.

**Action.** Filtering moved into `visibleCommentWhere` (line 43), which returns `{ visibility: "PUBLIC" }` for a viewer and `{}` otherwise, and `ticketIncludeForRole` (line 47), which is now used by `getTicket` at line 108 and by the `ticket.update` inside the transaction at line 213. I tested the query shape rather than the response body, asserting `include.comments.where` equals `{ visibility: "PUBLIC" }` for a viewer and `{}` for an agent, because a body assertion passes by accident whenever the fixture has no internal comments.

**Result.** The case is pinned at `tests/api/ticket-service.test.ts:90-106`, and the integration test independently seeds one PUBLIC and one INTERNAL comment against a real database so the filter is exercised with data that would expose it.

## Story 3: proving "writes nothing" with a real database

**Situation.** The claim that a viewer PATCH creates no audit row and no outbox event was only proved as "no mock was called", because `tests/api/ticket-service.test.ts:15` replaces the entire Prisma client.

**Task.** Get database-level evidence without making the default test run require infrastructure.

**Action.** I wrote `tests/integration/ticket-patch.int.test.ts`, guarded by `describe.skipIf(!url)` on `TEST_DATABASE_URL` (line 10), with the four commands to run it in a comment at the top of the file. It creates two tenants, a viewer and an agent in tenant A, a customer, one ticket and two comments, one PUBLIC and one INTERNAL (lines 30-33), then counts audit and outbox rows around three viewer PATCH shapes and one agent PATCH, and finally asks an agent of tenant A for tenant B's ticket id.

**Result.** Skipped by default; against a disposable PostgreSQL 18 with the schema pushed, both cases passed: the viewer shapes left both counts unchanged, the agent PATCH added exactly one audit row and one outbox event, and the cross-tenant id was a 404.

## Resume bullets

- Added a bounded serialization-failure retry to a Prisma service so `Serializable` transactions behave as designed under contention, retrying only on P2034 and surfacing every other error unchanged; covered by three unit tests asserting exact transaction call counts.
- Closed a role-based data leak by making comment visibility part of the shared response policy, so `INTERNAL` notes are excluded from PATCH responses as well as reads, verified by asserting the generated Prisma include rather than the response body.
- Placed the ticket edit permission check ahead of the database lookup so an unauthorised PATCH, including an empty body, produces no query, no audit row and no outbox event; proved with three parameterised unit cases and again against PostgreSQL.
- Wrote an opt-in PostgreSQL integration suite covering multi-tenant isolation, driven by `TEST_DATABASE_URL` so the default suite stays infrastructure-free; it confirmed a cross-tenant ticket id returns 404 and that an accepted PATCH writes exactly one audit row and one outbox event.
- Documented the project's boundaries where a reader hits them: demo auth headers with no credential check, mocked Prisma proving call shape rather than durability, and a worker whose claim is not safe for two instances.

## 60-second spoken summary

Master3 is a multi-tenant support desk: an Express and Prisma API, a pure domain package holding the ticket rules, a polling outbox worker and a Vite frontend. My slice is the ticket. Two things decide the design. First, authorization sits at the service boundary, before any database work, so a viewer's PATCH is refused in the first three lines of `updateTicket` and cannot produce a lookup, an audit row or an outbox event, not even with an empty body. Second, visibility is a response policy rather than an endpoint feature: a viewer sees public comments only, and that has to hold on the object returned from a write, not just on a read, which is the leak I fixed. Accepted mutations write the ticket, an audit row and an outbox event inside one serializable transaction. The other change I would talk about is the retry: serializable isolation aborts the loser of a conflict and expects a retry, and there was not one, so the isolation level was a promise the code could not keep. I added a three-attempt wrapper that retries only on the serialization code. And I would be clear that the unit tests mock Prisma, so the durability evidence comes from a separate integration test that only runs when you point it at a real database.

## What I would do next

- Map `assertTicketTransition`'s plain `Error` to a 409 or 422. Today an invalid status change becomes a 500 with the domain message (`apps/api/src/middleware/errors.ts:32-33`), which tells a client the wrong thing about whose fault it was.
- Re-read the ticket inside the transaction before applying a status change, since the current check happens before the retry loop and a successful retry can act on a stale `existing`.
- Decide whether a viewer's own public comment should set `firstResponseAt` (`ticketService.ts:262`). As written, a customer-side reply can satisfy a first-response metric.
- Replace the worker's find-then-update claim with `FOR UPDATE SKIP LOCKED` or a lease, so a second worker instance cannot double-process and a crash mid-batch does not strand rows in `PROCESSING`.
- Move ticket numbering off `max(number) + 1` onto a per-tenant sequence, or add a unique constraint on `[tenantId, number]` so the retry has something to protect.
