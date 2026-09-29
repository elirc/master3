# System design follow-ups: Master3 support desk

Each answer starts from the code as it is. Paths are relative to the project root.

## Today's shape

```
  client
    | x-tenant-slug, x-user-email        (demo headers, no credential check)
    v
  authMiddleware ---- no active user in that tenant -> 401
    |  req.auth = { tenantId, userId, role, email }   from the stored row
    v
  ticketRoutes ------ zod parse -> ZodError -> 400 with error.flatten()
    v
  ticketService
    |  canEditTicket(role)                    -> 403, before any query
    |  ticket.findFirst({ id, tenantId })     -> 404
    |  assertTicketTransition(...)            -> throws Error -> 500 (rough edge)
    |  canAssignTicket + assignee lookup      -> 403 / 404
    v
  withSerializableRetry( up to 3 attempts, P2034 only )
    +-- $transaction(Serializable) -----------------------------+
    |     ticket.update   (include is role-aware)               |
    |     auditLog.create      who did what                     |
    |     outboxEvent.create   topic ticket.updated             |
    +--------------------- commit ------------------------------+
    v
  enrichTicket -> slaState computed from now(), never stored
                                   |
                                   v
          apps/worker: poll PENDING, take 10, mark PROCESSING -> PROCESSED
```

## 1. Multi-tenancy at 500 tenants: is a per-query predicate enough?

Isolation here is one predicate repeated in every query: `tenantId: auth.tenantId` in the list where (`apps/api/src/modules/tickets/ticketService.ts:71`), in `getTicket` (line 107), in the update lookup (line 177), in the assignee check (line 193). It is correct today and the integration test proves a cross-tenant id is a 404. It is also one forgotten `where` away from a leak, with nothing underneath to catch it, and Prisma makes that easy: an `undefined` value drops a filter silently rather than failing.

Two ways to make it structural. PostgreSQL row-level security with the tenant set per connection gives a guarantee that holds for queries nobody reviewed, at the cost of a session variable on every pool checkout and a harder debugging story. A Prisma client extension that injects the tenant is cheaper and keeps the guarantee inside the application, which means it does not protect raw SQL or a migration script. At this size I would take the extension and add a lint rule banning `prisma.` outside the service layer; RLS becomes worth its complexity when the compliance conversation starts.

## 2. Concurrent writers: what the retry actually protects

`withSerializableRetry` (lines 22-31) bounds retries at three and only for P2034, and it wraps the transaction, not the reads before it. That distinction is the interesting one. In `updateTicket` the existence lookup (line 176) and the transition check (line 183) happen once, outside the loop; a retry re-runs the writes against a decision made before the first attempt. Two agents closing the same ticket therefore both pass the transition check, one commits, the other retries and commits too, and the second write silently wins.

Making that correct means re-reading the ticket inside the transaction and re-asserting the transition there, which costs one read per attempt. The alternative is optimistic concurrency: a `version` column with `update ... where version = :seen`, a zero-row update meaning "someone got there first", and a 409 to the client. I prefer the version column here because it turns a lost update into a visible conflict the user can resolve, rather than a race resolved by whoever was scheduled second.

## 3. Background jobs: the worker cannot scale to two instances

`apps/worker/src/worker.ts:6-34` selects the ten oldest `PENDING` events, then updates each to `PROCESSING`, logs it, and updates it to `PROCESSED`, falling back to `FAILED` with `lastError` on an exception. The find and the claim are separate statements, so two workers select the same batch and both process it: at-least-once becomes at-least-twice by construction. If the process dies between the two updates, the row stays `PROCESSING` forever, because the query only looks for `PENDING` and nothing reaps.

The fix is a real claim: `SELECT ... FOR UPDATE SKIP LOCKED` over the batch inside a transaction that also writes the `PROCESSING` stamp, plus a `lockedUntil` timestamp so a crashed worker's rows become eligible again. Add a `FAILED` retry policy with backoff and a terminal dead-letter state, since today a failed event stays `FAILED` and no code path ever revisits it. Trade-off: `SKIP LOCKED` gives up strict ordering between workers, which is fine for `ticket.updated` notifications and would not be for an event stream a consumer replays.

## 4. Pagination and search at a million tickets

`listTickets` pages with `skip: (page - 1) * pageSize` and `take`, plus a parallel `count` on the same where (lines 88-100), ordered by `[{ priority: "desc" }, { updatedAt: "desc" }]`. Deep offsets make PostgreSQL produce and discard every skipped row, and the count gets slower as filters get less selective, so page 900 costs far more than page 1 while looking identical in the code.

Keyset pagination on `(priority, updatedAt, id)` with a matching composite index replaces it, at the cost of losing random page access and the exact total; an approximate count from statistics is usually enough for a UI that just needs "more". The search filter is the second problem: `contains` with `mode: "insensitive"` over subject, description, customer name and customer email (lines 76-85) is an unanchored substring scan that no btree can serve. A generated `tsvector` column with a GIN index handles word search; `pg_trgm` handles genuine substring matching. Both are migrations, not rewrites, because the call site is one `where` clause.

## 5. Auth: replacing the demo headers

`authMiddleware` takes `x-tenant-slug` and `x-user-email`, defaults both, and looks up an active user in that tenant (`apps/api/src/middleware/auth.ts:20-26`). The important property to preserve is that role and `tenantId` come from the database row, never from the request, so downstream authorization is already trustworthy once identity is.

The replacement is narrow: authenticate the user with a session cookie or bearer token in front of this middleware, keep the tenant selection as a header but validate it against the user's memberships instead of a single join, and drop both defaults. Everything after, including `requireRole` (line 43) and every tenant predicate, is unchanged. The one design decision hiding here is that `User` currently belongs to exactly one tenant, so "which tenant am I acting in" is not really a question yet; supporting consultants who work across tenants turns it into a membership table and makes the header meaningful.

## 6. Observability: what the code already gives you

Two durable trails exist. Every accepted mutation writes an `auditLog` row with actor, action, entity and metadata, and every notable one writes an `outboxEvent`. That covers the business timeline. What is missing is operational: no request id, no structured logs, the worker logs to `console.log`, and `errorMiddleware` returns `error.message` on a 500 (`apps/api/src/middleware/errors.ts:32-33`) without recording anything.

First change is a request id attached to the response and stored on the audit row's metadata, so a support ticket resolves to one request. Second is a counter on 403s and 404s by route: a spike in PATCH 404s from one actor is exactly the enumeration attempt that the early role gate is designed to prevent, and today nothing would surface it. Third is a gauge on `outboxEvent` rows in `PENDING` older than a minute, which is the single most useful alert this system can have, because a stalled worker is silent otherwise.

## 7. The SLA field: derived now, what happens when it must be queryable?

`slaState` is computed per response by `getSlaState` from the current time (`ticketService.ts:58-67`, `packages/domain/src/index.ts:56`), which is why it is always right and never stale. The moment a product manager asks for "show me all breached tickets" or "alert when a ticket goes AT_RISK", derivation stops being enough, because you cannot filter or index on a value that does not exist in the database.

Two options. Query on the underlying data instead: breached is `slaDueAt < now()` and status not in the paused set, which is expressible in SQL and indexable on `(tenantId, status, slaDueAt)` without storing anything new. Or materialise `slaState` on the row and keep it fresh with a scheduled job, which buys simple queries and introduces a window where the column is wrong. I would take the first for filtering and use the outbox plus a scheduler for alerting, so the derived value stays derived and only notifications need a clock.

## 8. Moving this to ASP.NET Core

Mostly mechanical. `prisma.$transaction(fn, { isolationLevel: Serializable })` becomes `BeginTransactionAsync(IsolationLevel.Serializable)` with one `SaveChangesAsync`; the P2034 check becomes a `PostgresException.SqlState == "40001"` test inside the same bounded retry loop; `HttpError` becomes an exception mapped to `ProblemDetails` by middleware; `updateTicketSchema.parse` becomes a validated request record. The pure rules in `packages/domain/src/index.ts` port to a class library with no EF reference, which is where they belong in either stack.

Two things need care. The role-aware include has no direct EF equivalent, because `Include` cannot be filtered per role as tidily; the idiomatic version projects to a DTO with a `Where` on the comments collection, which is arguably clearer and makes the leak this project fixed harder to reintroduce. And the mocked-Prisma test style does not translate: in .NET the honest equivalent is `WebApplicationFactory` against a real PostgreSQL container, which is the shape `tests/integration/ticket-patch.int.test.ts` already has and the only place this repository proves anything about the database.
