# Take-home: ticket watchers

Budget 3 to 4 hours in this repository. No new dependencies, no database required: the existing mocked service suite is the target.

## The brief

Agents want to follow tickets they are not assigned to. Add watchers.

`POST /api/tickets/:id/watchers` with body `{ "userId": string }` and `DELETE /api/tickets/:id/watchers/:userId`.

Behaviour:

1. Add a `TicketWatcher` model to `prisma/schema.prisma` with `tenantId`, `ticketId`, `userId`, `createdAt`, a unique constraint on `[ticketId, userId]` and an index on `[tenantId, userId]`. Write the migration; do not run it.
2. Only roles that pass `canEditTicket` may add or remove a watcher (`packages/domain/src/index.ts:83`), and the check must come before any Prisma call, exactly as `updateTicket` does at `apps/api/src/modules/tickets/ticketService.ts:172`. A viewer gets 403 with no lookup.
3. The ticket and the watched user must both be resolved with the tenant in the `where`, the user additionally with `active: true`, matching the assignee lookup at `ticketService.ts:191-197`. A miss on either is 404.
4. Adding a watcher who is already watching is idempotent: 200 with the existing row, no audit row, no outbox event. Do not rely on catching P2002 for this; that code is reserved for genuine conflicts and the retry wrapper deliberately does not retry it.
5. A successful add or remove writes the watcher row, an `auditLog` row with action `ticket.watcher_added` or `ticket.watcher_removed`, and an `outboxEvent` with topic matching the action, all in one transaction.
6. Use `Serializable` and wrap the transaction in `withSerializableRetry` (`ticketService.ts:22`), or argue in your notes why read-committed is correct here, as `addTicketComment` does at line 250. Either answer can be right; an unstated choice cannot.
7. `getTicket` gains the watcher list in its include. A viewer must not see it at all: extend the role-aware include in `ticketIncludeForRole` (line 47) rather than adding a second code path.

## Acceptance criteria

- Viewer add and viewer remove both reject with 403 and call neither `prisma.ticket.findFirst` nor `prisma.$transaction`.
- An agent adding a watcher from another tenant, or an inactive user, gets 404 with no writes.
- A successful add calls `auditLog.create` once and `outboxEvent.create` once, both with `tenantId` and `actorId` from the auth context.
- A duplicate add writes nothing and returns the existing row.
- A viewer `getTicket` include contains `{ visibility: "PUBLIC" }` for comments and no watchers key; an agent include has `{}` for comments and watchers present.
- The 17 existing tests still pass unchanged.

## Where the code goes

- Service: `apps/api/src/modules/tickets/ticketService.ts`.
- Routes: `apps/api/src/modules/tickets/ticketRoutes.ts`, using `asyncHandler` and a Zod schema parsed at the route the way the existing endpoints do at line 34.
- Schema: `prisma/schema.prisma` plus a migration folder.
- Tests: add to `tests/api/ticket-service.test.ts`. Extend the hoisted `mocks` object (line 4) with the new delegates; reuse the `viewer` and `agent` contexts at lines 19-31 and the `$transaction` implementation from the `beforeEach` at line 47.
- Optional: a case in `tests/integration/ticket-patch.int.test.ts`, which skips unless `TEST_DATABASE_URL` is set.

## How to run it

```
npx vitest run
npm run typecheck
```

`test` in the root `package.json` is `vitest run`, and the config is `vitest.config.ts` at the root. The baseline is 17 unit tests passing with the integration file skipped, and typecheck at exit 0. To exercise the integration file you need a disposable PostgreSQL and `TEST_DATABASE_URL`; the four commands are in the comment at the top of that file.

## What to submit

A branch plus a `NOTES.md` of at most one page: your isolation-level decision and its reasoning, how you made the duplicate add idempotent without leaning on P2002, why the watcher list is excluded from a viewer's include rather than stripped from the response afterwards, and what your tests do not prove.

## Grading rubric

| Criterion | Strong | Weak |
| --- | --- | --- |
| Guard placement | `canEditTicket` before any Prisma call, with a test asserting `findFirst` and `$transaction` were never called | Permission checked after the lookup, turning the endpoint into an existence oracle |
| Tenant scoping | Both the ticket and the watched user resolved with `tenantId` in the `where`, user also `active: true`; 404 on either miss | Watched user fetched by id alone, allowing a cross-tenant watcher row |
| Idempotency | Existing-watcher check inside the transaction, early return with no audit or outbox write, tested | Relies on catching P2002, which the retry wrapper is written not to retry |
| Durable effects | Row, audit and outbox in one transaction, `tenantId` and `actorId` from the auth context | Audit or outbox written outside the transaction, so a rollback leaves a phantom event |
| Response policy | Watchers added to `ticketIncludeForRole` so a viewer's query never selects them | Watchers included for everyone and deleted from the object before responding |
| Isolation choice | A stated choice with a reason, and `withSerializableRetry` used if `Serializable` is chosen | `Serializable` without the wrapper, which is the exact defect the wrapper exists to fix |
| Tests | Cases for both roles, both verbs, duplicate, cross-tenant and inactive user; each refusal asserts no writes | Happy path only, or refusals tested for status but not for side effects |

## Reviewer's notes

Read first: the first three lines of each new service function. This codebase has one strong habit, which is that the cheapest and least informative refusal comes first, and a reviewer checks whether you kept it. The comment above `ticketService.ts:172` states the reasoning; a submission that moves the check after the lookup has not read it.

Second: whether `auditLog` and `outboxEvent` are written on `tx`. The whole point of the outbox here is that the intent to notify commits with the change, so the worker in `apps/worker/src/worker.ts` never sees an event for work that rolled back. A write on the global `prisma` client inside a transaction callback is invisible in a mocked test unless you assert which client was used, so assert it.

Third: the isolation-level paragraph in your notes. `updateTicket` is serializable and wrapped; `addTicketComment` is not, because it does not read a value and then write based on it. Watchers with a unique constraint are arguably in the second category. Either answer is fine; "I used Serializable because the other one did" is not.

Fourth: the viewer include. Filtering in the query rather than in the response is the lesson the worked change of this project is built on, since a stripped-after-the-fact field comes back the moment someone adds a new endpoint that returns the same object.

Not required: performance work on the watcher list, or a notification consumer. If you write an integration case, remember it must skip without `TEST_DATABASE_URL` and clean up every table it touches in `afterAll`.
