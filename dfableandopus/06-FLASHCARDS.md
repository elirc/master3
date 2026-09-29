# Flashcards: Master3 support desk

Cover the right column. Every answer is checkable in the repository.

| Question | Answer |
| --- | --- |
| Four roles in the domain | `ADMIN`, `MANAGER`, `AGENT`, `VIEWER` |
| Which roles pass `canEditTicket` | ADMIN, MANAGER, AGENT |
| What `canAssignTicket` does | Delegates to `canEditTicket` (`packages/domain/src/index.ts:78`) |
| First statement in `updateTicket` | The `canEditTicket` role gate, before any Prisma call |
| Three reasons the gate comes first | No existence oracle, no database work for an unauthorised caller, and an empty PATCH is still refused |
| Status for a viewer PATCH | 403 "You do not have permission to update tickets" |
| Status for a ticket id in another tenant | 404 "Ticket not found" |
| Tenant predicate used in the update lookup | `where: { id, tenantId: auth.tenantId }` |
| Function returning the comment filter | `visibleCommentWhere`, `{ visibility: "PUBLIC" }` for a viewer, `{}` otherwise |
| Why the same include is used on PATCH | Filtering only reads leaks internal notes through the write response |
| Two call sites of `ticketIncludeForRole` | `getTicket` at line 108 and the transactional `ticket.update` at line 213 |
| Prisma code meaning serialization failure | P2034 |
| Attempts made by `withSerializableRetry` | Three |
| What it does with a P2002 | Rethrows immediately, no retry |
| What it does with an `HttpError` | Rethrows immediately; it is a decision, not contention |
| Why the retry exists at all | Serializable aborts the loser of a conflict and expects the caller to run it again |
| Which mutations are serializable | `createTicket` and `updateTicket`; `addTicketComment` is not |
| Why `addTicketComment` needs no retry | It does not read a value and then write based on it, so it runs at read-committed |
| How ticket numbers are generated | Highest `number` for the tenant plus one, inside the serializable transaction |
| Three rows written by an accepted PATCH | The ticket update, an `auditLog` row, an `outboxEvent` |
| Audit action for an update | `ticket.updated` |
| Outbox topic for an update | `ticket.updated`, payload with `ticketId`, `status`, `assignedUserId` |
| Audit actions for comments | `ticket.public_reply_added` and `ticket.internal_note_added` |
| Outbox topic for a public comment | `notification.customer_reply`, and no event at all for an internal note |
| Only role rule in `addTicketComment` | A viewer may not create an `INTERNAL` note |
| Side effect of the first PUBLIC comment | Sets `ticket.firstResponseAt`, regardless of author role |
| Statuses that make `getSlaState` return PAUSED | `PENDING`, `RESOLVED`, `CLOSED` |
| Result when `dueAt` is null | `MET` |
| Threshold for `AT_RISK` | One hour or less remaining |
| SLA minutes per priority | LOW 72h, NORMAL 24h, HIGH 8h, URGENT 2h |
| Special rule for an agent closing a ticket | Allowed only from `RESOLVED` or `PENDING` |
| Transitions allowed out of `CLOSED` | Only back to `OPEN` |
| What `assertTicketTransition` throws | A plain `Error`, which becomes a 500 rather than a 409 |
| What `errorMiddleware` maps explicitly | `ZodError` to 400 with `error.flatten()`, `HttpError` to its status |
| Headers read by `authMiddleware` | `x-tenant-slug` and `x-user-email`, both defaulted |
| Status when no matching active user exists | 401 |
| Where role and tenant id come from | The stored user row, never the request |
| How the list endpoint paginates | `skip` and `take` with a parallel `count` on the same `where` |
| Ordering of the list query | `priority` descending, then `updatedAt` descending |
| Fields the search filter scans | Ticket subject and description, customer name and email, all `contains` insensitive |
| How the worker selects work | `findMany` on `status: "PENDING"`, oldest first, take 10 |
| Worker status progression | PENDING to PROCESSING with an attempts increment, then PROCESSED, or FAILED with `lastError` |
| Why a second worker instance is unsafe | Find and claim are separate statements, so both instances take the same batch |
| Recorded unit test count | 17 passing, integration file skipped, typecheck exit 0 |
| Env var enabling the integration suite | `TEST_DATABASE_URL` |
| What the integration test proves | Viewer PATCH shapes leave audit and outbox counts unchanged, an agent PATCH adds one of each, cross-tenant id is 404 |
| What the mocked unit suite cannot prove | Rollback, locking, serialization behaviour, durability |
