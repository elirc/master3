# Concepts: tenant-safe CRUD

## Authentication and authorization are two decisions

## Authentication and authorization are two decisions

## Authentication and authorization are two decisions

**Predict before you read on:** a viewer sends a PATCH with only `priority`; which layer refuses it, and what has been read from the database by then?

**Predict before you read on:** a viewer sends a PATCH with only `priority`; which layer refuses it, and what has been read from the database by then?

## Tenant scope is part of every lookup

**Predict before you read on:** a valid ticket id from tenant B is used with a tenant A session; 403, 404 or 200?

**Predict before you read on:** a viewer sends a PATCH with only `priority`; which layer refuses it, and what has been read from the database by then?

## Tenant scope is part of every lookup

## Comment visibility is response policy

**Predict before you read on:** which of GET and PATCH returned the internal note before the repair, and why did they differ?

**Predict before you read on:** a valid ticket id from tenant B is used with a tenant A session; 403, 404 or 200?

## Accepted writes are one transaction

**Predict before you read on:** the outbox insert fails after the ticket update; what does the client see, and does the audit row exist?

Authentication and authorization answer different questions. The middleware finds an active user in the tenant named by `x-tenant-slug`; it does not decide whether that user may mutate a ticket. The domain role then supplies a second decision. `VIEWER` can read tickets and public comments. `ADMIN`, `MANAGER`, and `AGENT` can perform operational ticket edits. The service uses `canEditTicket` before its first ticket lookup, so the rule still applies when a caller bypasses Express.

## Tenant scope is part of every lookup

## Comment visibility is response policy

**Predict before you read on:** which of GET and PATCH returned the internal note before the repair, and why did they differ?

**Predict before you read on:** a valid ticket id from tenant B is used with a tenant A session; 403, 404 or 200?

## Accepted writes are one transaction

**Predict before you read on:** the outbox insert fails after the ticket update; what does the client see, and does the audit row exist?

Tenant scope is part of every ticket lookup and related-user lookup. `where: { id, tenantId: auth.tenantId }` means a valid id from another tenant behaves like a missing row. The same predicate appears in customer and assignee checks. This prevents a client from taking a ticket id or assignee id discovered in one tenant and attaching it to another. The database schema adds foreign keys and indexes, but the service remains responsible for selecting only rows from the active tenant.

## Comment visibility is response policy

**Predict before you read on:** which of GET and PATCH returned the internal note before the repair, and why did they differ?

Comment visibility is response policy. `visibleCommentWhere("VIEWER")` produces `{ visibility: "PUBLIC" }`; an operational role receives `{}` and can see internal notes. `getTicket` and `ticketIncludeForRole` use that policy. Before the repair, GET filtered comments but the update response used the unfiltered `ticketInclude`, so a harmless priority PATCH could disclose an internal note. Response shaping belongs beside authorization because the output is part of the endpoint contract.

## Accepted writes are one transaction

**Predict before you read on:** the outbox insert fails after the ticket update; what does the client see, and does the audit row exist?

Accepted writes use Prisma’s serializable transaction. The ticket update, audit log, and outbox event either all commit or all roll back. The outbox is durable handoff data; the worker later delivers its effect. No route should publish an external notification before its transaction succeeds. A viewer request that fails the role gate has no transaction, database lookup, audit row, or outbox event. An agent request with `{ priority: "URGENT" }` updates the priority, records `ticket.updated`, and returns only the comments that agent is allowed to see. These small contracts compose into predictable CRUD behavior.

## Serializable means "retry", or it means nothing

`Serializable` is the isolation level that lets PostgreSQL refuse a commit whose result could not have come from some serial order of the concurrent transactions. The refusal is an error (`40001`, which Prisma reports as `P2034`), and the contract is that the *application* retries. The delivered service asked for `Serializable` and never retried, so under contention the second writer would have answered 500. `withSerializableRetry` in `ticketService.ts` (fix pass) re-runs the whole transaction callback up to three times on `P2034` and nothing else: an `HttpError` (403, 404, 409) is a decision, not contention, and a `P2002` unique violation will not go away by retrying. Predict before reading the tests: if the callback has already created an audit row when the serialization failure arrives, how many audit rows exist after a successful retry? (One: the failed attempt rolled back with its transaction.)

