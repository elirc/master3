# Interview questions: Master3 support desk

Paths are relative to the project root. Each question is marked junior or mid.

## Screening

**S1 (junior). Describe the ticket data model in one breath.**
A `Ticket` belongs to a tenant and a customer, carries a per-tenant `number`, a status, a priority, tags, `slaDueAt`, `firstResponseAt` and `resolvedAt`, and owns `TicketComment` rows. Each comment has a `visibility` of `PUBLIC` or `INTERNAL` (`prisma/schema.prisma:132-144`) and is indexed on `[tenantId, ticketId, createdAt]`. Alongside those are `AuditLog` and `OutboxEvent`, both tenant-scoped, both written by the same transactions that change tickets.

**S2 (junior). Walk the request path for a ticket PATCH.**
`authMiddleware` resolves the actor (`apps/api/src/middleware/auth.ts:19`), the route parses the body with `updateTicketSchema.parse` (`apps/api/src/modules/tickets/ticketRoutes.ts:34`), and `updateTicket` (`apps/api/src/modules/tickets/ticketService.ts:168`) does the work: role gate, tenant-scoped lookup, transition check, assignment checks, then one transaction writing the ticket, the audit row and the outbox event. `asyncHandler` forwards a rejection to `errorMiddleware` (`apps/api/src/middleware/errors.ts:21`).

**S3 (junior). Which boundary validates input, and which one authorizes?**
Different boundaries on purpose. Zod validates shape at the route (`ticketRoutes.ts:34`) and a `ZodError` becomes 400 with `error.flatten()` (`errors.ts:22-24`). Authorization lives in the service, not the route, so any caller of `updateTicket` is gated, and the rule functions themselves are pure and live in `packages/domain/src/index.ts`.

**S4 (mid). Where does the tenant come from and how is it enforced?**
`authMiddleware` reads `x-tenant-slug` and `x-user-email`, both defaulted, and looks up an active user joined to that tenant slug (`apps/api/src/middleware/auth.ts:20-26`); no match is a 401. Enforcement is then per query: every lookup carries the tenant, for example `where: { id, tenantId: auth.tenantId }` at `ticketService.ts:177`, so a foreign id misses and produces a 404 rather than another tenant's row. The headers are a demo fixture with no credential check, which is stated in the course rather than hidden.

**S5 (junior). What does `enrichTicket` add and why is it not a column?**
`slaState`, computed by `getSlaState` on the way out (`ticketService.ts:58-67`). It is derived from the current time, the status and `slaDueAt`, so storing it would mean a row that is wrong one minute after it is written. `PENDING`, `RESOLVED` and `CLOSED` return `PAUSED`, a missing due date is `MET`, a past due date is `BREACHED`, and within an hour is `AT_RISK` (`packages/domain/src/index.ts:56-67`).

**S6 (junior). What is the outbox here and who reads it?**
`tx.outboxEvent.create` inside each mutation transaction records the intent to notify, so nothing is sent for work that rolls back. `apps/worker/src/worker.ts:6-34` polls `status: "PENDING"` in `createdAt` order, takes 10, marks each `PROCESSING` with an attempt increment, logs it, then marks it `PROCESSED`, or `FAILED` with `lastError` on an exception.

**S7 (mid). Which roles exist and what can each do?**
`ADMIN`, `MANAGER`, `AGENT`, `VIEWER` (`packages/domain/src/index.ts:3`). `canEditTicket` is true for the first three (line 83), `canAssignTicket` delegates to it (line 78), `canManageUsers` is admin only (line 74), and `canViewInternalNote` is again the first three (line 70). A viewer can read tickets, see public comments, and post a public comment; everything else is refused.

**S8 (junior). What status code does a cross-tenant ticket id produce?**
404 "Ticket not found" (`ticketService.ts:181`), because the scoped `findFirst` returns null and the code cannot distinguish "does not exist" from "not yours". The integration test at `tests/integration/ticket-patch.int.test.ts:68` asserts exactly that for an agent of tenant A reaching for tenant B's ticket.

## Deep dive

**D1 (mid). Why is the role gate before the lookup instead of after it?**
`updateTicket` refuses a viewer at lines 172-174, before `prisma.ticket.findFirst`. Order matters for three reasons. A viewer cannot use PATCH as an existence oracle for ticket ids. A viewer cannot cause any database work, which matters because the transaction also writes audit and outbox rows. And an empty PATCH body, which passes Zod, is still refused. The test is parameterised over priority, tags and `{}` (`tests/api/ticket-service.test.ts:55-63`) and asserts both `findFirst` and `$transaction` were never called.

**D2 (mid). The bug the worked change fixed: what was leaking?**
Comment visibility was applied when reading a ticket but not to the object returned from an update, so an agent-only internal note could be returned in a PATCH response to a role that must never see it. The fix is that both paths build their include the same way: `getTicket` uses `ticketIncludeForRole(auth.role)` at line 108 and the update inside the transaction uses it again at line 213, both resolving to `visibleCommentWhere` at line 43, which returns `{ visibility: "PUBLIC" }` for a viewer and `{}` for everyone else. `tests/api/ticket-service.test.ts:90-106` asserts the viewer query carries the PUBLIC filter and the agent query carries `{}`.

**D3 (mid). Explain `withSerializableRetry` and why the code needs it.**
`ticketService.ts:22-31`. It loops up to three attempts, runs the work, and rethrows anything that is not a `PrismaClientKnownRequestError` with code P2034. Serializable isolation does not queue conflicting transactions, it aborts one of them with a serialization failure and expects the caller to retry. Without the wrapper the isolation level is a promise the code cannot keep: the losing writer would surface a 500 to a user whose request was perfectly valid. Three unit tests cover it: retry then succeed with two transaction calls (line 129), give up after three and surface the P2034 (line 135), and no retry at all for P2002 (line 144).

**D4 (mid). Why only P2034 and not, say, P2002 as well?**
Because they mean opposite things. P2034 is "this transaction was aborted to preserve serializability, try again" and a retry is expected to succeed. P2002 is a unique constraint violation: the same input will violate it again, so retrying is pure waste and would hide a genuine conflict behind a delayed failure. The narrow condition at line 27 is the whole point of the wrapper, and the test at line 144 exists to keep it narrow.

**D5 (mid). What does the ticket number generation do and what is wrong with it?**
`createTicket` reads the highest existing `number` for the tenant and adds one (`ticketService.ts:125-135`). It is inside a `Serializable` transaction wrapped by the retry, which is the reason this is defensible: two concurrent creates conflict, one aborts with P2034 and retries, and the second attempt sees the committed number. The honest caveats are that it is O(one indexed read) per create rather than free, that a burst of creates can exhaust three attempts and surface an error, and that a per-tenant sequence or a unique constraint on `[tenantId, number]` would be the sturdier design.

**D6 (mid). Walk the refusal order inside `updateTicket` and say why it is that order.**
Role gate (172), tenant-scoped lookup and 404 (176-181), status transition check when a status is present (183-185), assignment permission when `assignedUserId` is in the body at all including null (187-189), then assignee existence scoped to tenant and `active: true` (191-197), then the transaction. Cheapest and least informative refusals come first; everything that could write comes last. Note the deliberate `!== undefined` on line 187: unassigning is still an assignment action.

**D7 (mid). `assertTicketTransition` throws a plain `Error`, not an `HttpError`. What does the client see?**
A 500 with the message "Cannot transition ticket from X to Y", because `errorMiddleware` only special-cases `ZodError` and `HttpError` and falls through to `res.status(500).json({ error: message })` at `errors.ts:32-33`. That is a real rough edge: an invalid transition is a client error and deserves a 409 or 422. The domain package throwing a domain error rather than an HTTP error is right; the service should be catching it and mapping it.

**D8 (mid). What breaks if you delete line 187, the `canAssignTicket` check?**
Nothing visibly, today, because `canAssignTicket` delegates to `canEditTicket` (`packages/domain/src/index.ts:78-80`) and a viewer has already been refused at line 172. That is exactly why it should stay: it documents that assignment is a separate capability and gives you one line to change on the day assignment becomes manager-only. Deleting it makes a future policy change a search-and-reason exercise instead of an edit.

**D9 (mid). `addTicketComment` does not use the retry wrapper. Is that a bug?**
It uses a plain `prisma.$transaction` at line 250 with no isolation level set, so it runs at the default read-committed and has nothing to retry. That is consistent: the comment path inserts a row and conditionally stamps `firstResponseAt` (line 262), and it does not read-then-write a value that another transaction could invalidate. The claim to avoid is saying the whole service is serializable; two of the three mutations are, and this one is not, for a stated reason.

**D10 (mid). What does the audit row record and what would you change about it?**
`action: "ticket.updated"`, the entity and id, and `metadata: { before: existing, after: input }` (`ticketService.ts:223`). `existing` is the narrow select from line 178, so before-state is status, priority and `assignedUserId` only, and `after` is the raw request body, not the resulting row. So a PATCH that sets a field to its current value looks like a change, and fields not in the body are absent rather than unchanged. A diff computed from `existing` against `updated` would be truthful; the current shape is cheap and slightly misleading.

## Behavioral (STAR)

**B1 (mid). Tell me about a time you found that a safeguard was not actually safe.**
Situation: the service used `Serializable` isolation on ticket creation and update, which reads as a strong guarantee. Task: check what happens when two of them conflict. Action: PostgreSQL aborts one with a serialization failure and expects a retry, and there was no retry anywhere, so the loser would surface a 500 for a valid request. I wrote `withSerializableRetry`, three attempts, retrying only on P2034 and rethrowing everything else including `HttpError`, and wrapped both serializable transactions in it. Then I wrote three tests: one where the first attempt fails and the second succeeds, asserting exactly two transaction calls; one where all three fail and the P2034 surfaces; and one where a P2002 is not retried at all. Result: 17 unit tests pass and typecheck exits 0. During the change a scripted edit briefly dropped `addTicketComment` from the file; I restored the service from the stage copy, re-applied the wrapper, and the typecheck is what confirmed the file was whole again.

**B2 (mid). Tell me about a data leak you fixed.**
Situation: viewers must never see internal notes. The read path filtered them; the update path did not, so a PATCH response could carry an internal note to a role that cannot read one on GET. Task: make the response policy identical on both paths. Action: I moved comment filtering into `ticketIncludeForRole`, driven by `visibleCommentWhere`, and used it both in `getTicket` and in the `ticket.update` inside the transaction. Then I tested the query shape rather than the response body, asserting `include.comments.where` is `{ visibility: "PUBLIC" }` for a viewer and `{}` for an agent, because asserting the shape catches the leak even when a fixture happens to have no internal comments. Result: the case is pinned at `tests/api/ticket-service.test.ts:90`, and the integration test independently sets up one PUBLIC and one INTERNAL comment on a real database.

**B3 (mid). Tell me about writing a test that needed infrastructure you did not want to require.**
Situation: the unit suite mocks Prisma completely, so "a viewer PATCH writes nothing" was proved only as "no mock was called". Task: prove it against a real database without making the default suite need one. Action: `tests/integration/ticket-patch.int.test.ts` uses `describe.skipIf(!url)` on `TEST_DATABASE_URL` (line 10), creates two tenants, a ticket with one public and one internal comment, and asserts that three viewer PATCH shapes leave audit and outbox counts unchanged while an agent PATCH adds exactly one of each, and that a cross-tenant id is a 404. Result: skipped by default, and against a disposable PostgreSQL 18 with the schema pushed, both cases passed. The file header carries the four commands needed to run it, so nobody has to reconstruct them.

**B4 (junior). Tell me about a limitation you chose to document instead of fix.**
The auth headers. `authMiddleware` takes `x-tenant-slug` and `x-user-email`, defaults both, and looks up a user; there is no credential check at all. Replacing it means real sessions, which is a different project and would break the local walkthrough the course depends on. So it is stated in the course README, in the codebase map, and in the verification chapter, each time as "a teaching fixture, not production authentication". The tenant scoping it feeds is real and tested; the identity that selects the tenant is not.

**B5 (mid). Tell me about making documentation verifiable.**
The verification chapter used to end at a command. I added a "Run it yourself" section: docker compose up, migrate, seed, dev, then two curl commands, one viewer PATCH that returns 403 with no audit or outbox row and one agent PATCH that returns 200. The compose port in the instructions is read from `docker-compose.yml` rather than assumed. The result is that the central claim of the course, which is that authorization happens before any write, is something the reader watches happen rather than something they are told.

## Follow-ups an interviewer asks next

**F1. "Three retry attempts. Where did three come from?"**
It is the default parameter on `withSerializableRetry` (`ticketService.ts:22`), chosen as a bound rather than measured. The properties that matter are that it is bounded at all, that it retries immediately with no backoff, which is fine for two writers and poor for twenty, and that exhausting it surfaces the original P2034 rather than a synthesised error. Under real contention I would add jittered backoff and a metric on retry count, then pick the number from data.

**F2. "Retrying wraps the whole transaction, including the reads before it. Does that matter?"**
It wraps the transaction, not the reads before it: the existence lookup at line 176 and the assignee lookup at line 192 happen once, outside. So the retry re-runs the writes against a snapshot whose validity was checked before the first attempt. For status transitions that is a real gap, because `existing.status` could have changed between the check and the successful retry. The correct version re-reads inside the transaction, and the reason it is survivable today is that `canTransitionTicket` allows most changes and the audit row records what was attempted.

**F3. "A viewer can post a public comment. Can they set `firstResponseAt`?"**
Yes, and that is worth flagging. `addTicketComment` stamps `firstResponseAt` for any `PUBLIC` comment when it is unset (`ticketService.ts:262-264`), regardless of the author's role. If the metric means "time until the support team replied", a public comment by a viewer on their own ticket corrupts it. The gate that exists stops a viewer creating an `INTERNAL` note (line 240) and nothing else.

**F4. "Your list endpoint uses skip and take. What happens at a million tickets?"**
`listTickets` does `skip: (page - 1) * pageSize` with `take` and a separate `count` on the same where (`ticketService.ts:88-100`). Deep offsets make PostgreSQL walk and discard rows, and the `count` gets more expensive as filters get less selective. Ordering is `[{ priority: "desc" }, { updatedAt: "desc" }]`, so a keyset cursor on `(priority, updatedAt, id)` is the direct replacement, with an index to match. The trade-off is losing a total count and the ability to jump to page 40.

**F5. "The search filter uses `contains` with `mode: insensitive` on four fields. Comment?"**
It is an unanchored substring search over subject, description, customer name and customer email (`ticketService.ts:76-85`), so it cannot use a normal btree index and degrades into scans as the table grows. It is the right first implementation and the wrong thousandth. PostgreSQL full text search with a generated `tsvector` column and a GIN index, or a trigram index for genuine substring matching, is the upgrade; both are a migration rather than a rewrite because the call site is one `where` clause.

**F6. "Your worker marks an event PROCESSING and then PROCESSED. What if it dies in between?"**
The row stays `PROCESSING` forever, because nothing ever moves it back: the query only selects `status: "PENDING"` (`apps/worker/src/worker.ts:8`). There is no lease with an expiry and no claim that is safe against two workers, since the find and the update are separate statements. A single worker is fine, which is what this project runs; a second instance would double-process. `SELECT ... FOR UPDATE SKIP LOCKED`, or a `lockedUntil` timestamp with a reaper, is what makes it safe to scale out.
