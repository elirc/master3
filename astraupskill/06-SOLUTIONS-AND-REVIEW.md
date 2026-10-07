# Solutions and review

## Exercise solutions

**Exercise 1.** The surprises are the AGENT rule and the viewer no-op. `canTransitionTicket` (`packages/domain/src/index.ts:32-37`) checks in order: same status → true; VIEWER → false; AGENT moving to CLOSED → only from RESOLVED or PENDING; otherwise the `allowedTransitions` table. So AGENT OPEN→CLOSED is false while MANAGER OPEN→CLOSED is true; AGENT PENDING→CLOSED is true; NEW→CLOSED and CLOSED→RESOLVED are not in the table for anyone; RESOLVED→PENDING is false. VIEWER OPEN→OPEN is **true** because the same-status shortcut runs before the viewer check (finding F8).

**Exercise 2.** MET, AT_RISK, AT_RISK, BREACHED, PAUSED. The boundary is `msRemaining <= 60 * 60_000` (`:66`), so exactly 60 minutes and exactly zero are both AT_RISK; only a negative remainder is BREACHED (`:65`). The HIGH ticket was due 17:00; at 18:00 it shows PAUSED while PENDING and BREACHED the instant it reopens. `getSlaState` only *labels* the waiting period (`:57-58`); `slaDueAt` is stored once and recomputed only on a priority change (`ticketService.ts:208-211`). Really pausing needs a stored pause start (or accumulated paused time) and an update that pushes `slaDueAt` forward when the ticket leaves PENDING.

**Exercise 3.** The check passes because `canEditTicket` at `ticketService.ts:172` precedes the `findFirst` at `:176`, and `ticketIncludeForRole(auth.role)` is the include at `:108` and `:213`. The matrix:

| request and actor | status | audit rows | outbox rows | comments returned |
| --- | --- | --- | --- | --- |
| viewer PATCH `{ "priority": "URGENT" }` | 403 | 0 | 0 | none (error body) |
| viewer PATCH `{}` | 403 | 0 | 0 | none (error body) |
| agent PATCH `{ "priority": "URGENT" }` | 200 | +1 `ticket.updated` | +1 `ticket.updated` | PUBLIC and INTERNAL |
| viewer GET | 200 | 0 | 0 | PUBLIC only |

The first and third rows are what `tests/integration/ticket-patch.int.test.ts:53-66` asserts against real PostgreSQL when it is enabled.

**Exercise 4.** `assertTicketTransition` throws a plain `Error` (`index.ts:41`). `errorMiddleware` is not looking for that class, so it falls through to `res.status(500).json({ error: message })` (`errors.ts:32-33`): `500 {"error":"Cannot transition ticket from NEW to CLOSED"}`. A fix that keeps HTTP out of the domain: export a `TicketTransitionError extends Error` from the domain package and map it to 409 in `errorMiddleware`, or catch it in `updateTicket` and rethrow `new HttpError(409, error.message)`.

**Exercise 5.** Three places compute or set a ticket number: `createTicket` (`ticketService.ts:125-135`, Serializable with retry), the inbound-email route (`notificationRoutes.ts:33-43`, default isolation, no retry) and the seed (hard-coded 1001). Two simultaneous inbound emails both read the same highest number and both insert `N+1`. PostgreSQL's unique index on `@@unique([tenantId, number])` (`schema.prisma:125`) makes the second insert wait for the first and then fail with a unique violation; Prisma raises `P2002`, and the client gets a 500 while the first gets 202. `addTicketComment` runs at default isolation too, but it never computes a number.

**Exercise 6.** The read is `ticketService.ts:176-179`; the transition is checked at `:183-185`; the transaction opens at `:199` and contains only the update and two inserts. Take a NEW ticket. Agent A sends `{"status":"RESOLVED"}` and agent B sends `{"status":"PENDING"}`; both read NEW, and both transitions are legal from NEW. If A commits first, B writes PENDING over RESOLVED, a move the table forbids (`index.ts:28`). Serializable does not help: either B's transaction starts after A commits and sees no conflict, or PostgreSQL raises `40001` and `withSerializableRetry` re-runs the callback, which repeats the unvalidated update. Fixes: move the read and `assertTicketTransition` inside the callback so a retry re-validates, or make the write conditional (`updateMany({ where: { id, tenantId, status: existing.status } })` and treat zero rows as 409).

**Exercise 7.** As the viewer, `GET /api/admin/users` succeeds because that handler has no `requireRole` (`adminRoutes.ts:8-18`) and returns every user's email and role in the tenant. Send `x-user-email: <an ADMIN email>` to `GET /api/admin/audit-logs` and the gate at `:22` passes, because the role belongs to whichever row the header selects (`auth.ts:21-26`). Adding `requireRole(["ADMIN"])` to `/users` removes the enumeration step, but the seeded emails are guessable and listed in the web app (`apps/web/src/App.tsx:18`). The underlying problem is that identity is asserted, not proved.

## Senior review: what the course does not fix

Each finding was checked against the current source; line numbers are for this commit.

**F1. Identity is a header, and the user directory is open (high, local-only by design).** `auth.ts:20-21` defaults both headers to seeded values, so a request with no headers is `agent@acme.test`. `/api/admin/users` (`adminRoutes.ts:8-18`) is the only admin route without a role gate. Together they turn any caller into any user. Acceptable for a teaching fixture; a deployment blocker.

**F2. Client errors reported as 500, with raw messages (medium).** Invalid transitions (exercise 4) and any Prisma error both reach `errors.ts:32-33`, which echoes `error.message` to the client. Prisma messages include model and constraint names. Map known domain and Prisma codes (`P2002` → 409, `P2025` → 404) and return a generic body for the rest.

**F3. Transition validated against a stale read (medium).** Exercise 6. A second consequence: the audit row stores `metadata: { before: existing, after: input }` (`ticketService.ts:223`), so under the race the "before" it records is not the state that was actually overwritten.

**F4. The inbound-email route bypasses the ticket service (medium).** `notificationRoutes.ts:16-79` has no role gate (a VIEWER can create tickets), no audit row (unlike `createTicket`, `ticketService.ts:145-154`), and the number race of exercise 5. It is also not idempotent: `EmailMessage` has `@@unique([tenantId, externalId])` (`schema.prisma:160`), so a redelivered email fails with `P2002` → 500 instead of returning the ticket it already created, and the customer `upsert` (`notificationRoutes.ts:22-30`) runs outside the transaction. Route it through a service that looks up `externalId` first and reuses `createTicket`'s numbering and retry.

**F5. SLA clock can be reset or ignored (medium, product).** Changing priority recomputes `slaDueAt` from *now* (`ticketService.ts:208-211`): an URGENT ticket about to breach can be set to LOW and back to URGENT to get a fresh two hours. PENDING time is never credited back (exercise 2). `resolvedAt` is set on RESOLVED (`:207`) but never cleared on reopen, so resolution-time reports would count a reopened ticket as resolved.

**F6. Viewers count as first responders (low).** `addTicketComment` blocks only INTERNAL notes for viewers (`ticketService.ts:240-242`). A viewer's PUBLIC reply sets `firstResponseAt` (`:262-264`) and enqueues `notification.customer_reply` (`:277-284`), so a read-only user can satisfy the first-response metric and message the customer.

**F7. The outbox worker has no claim step (medium once scaled).** `worker.ts:7-11` selects PENDING rows and `:15-18` marks each PROCESSING in a separate statement, so two worker processes take the same batch and deliver twice. A crash between `:15` and `:22` leaves a row in PROCESSING forever; FAILED rows are never retried, and `attempts` is incremented but never compared to a limit. Claim with `UPDATE ... WHERE status = 'PENDING' ... FOR UPDATE SKIP LOCKED` (raw SQL in Prisma) and add a lease timeout.

**F8. Latent viewer no-op (low).** `canTransitionTicket` returns true for same-status moves before it checks for VIEWER (`index.ts:33-34`). It is unreachable through `updateTicket` today because `canEditTicket` runs first, but any new caller that relies on the domain function alone inherits it.
