# Practice exercises

Use the following synthetic fixture for every exercise: tenant slug `acme-support` maps to database tenant id `tenant-a`; `viewer@acme.test` is a `VIEWER`, and `agent@acme.test` is an `AGENT`. The ticket id is `t1`. It has priority `NORMAL`, one `PUBLIC` comment, and one `INTERNAL` comment. The slug is an HTTP lookup value; it is deliberately different from the database id so a test does not accidentally assert the wrong tenant predicate.

Exercise 1, trace a forbidden write. Send `PATCH /api/tickets/t1` with headers `x-tenant-slug: acme-support`, `x-user-email: viewer@acme.test`, and JSON `{ "priority": "URGENT" }`. Record the expected 403, `auth.tenantId = "tenant-a"`, `auth.role = "VIEWER"`, and the first database operation. The answer must identify `canEditTicket` as the first service decision and say that `prisma.ticket.findFirst` is never called. Repeat the trace for `{ "tags": ["billing"] }` and `{}`. Explain why all three cases have zero ticket mutations, audit inserts, and outbox inserts. A partial body is still one PATCH operation and cannot inherit write authority from the field it contains.

Exercise 2, implement the role boundary. Write this pure helper and explain each accepted role:

```ts
export function canEditTicket(role: ActorRole): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "AGENT";
}
```

Keep `canAssignTicket` for the narrower assignee rule. Then place the call at the first line of `updateTicket`, before the tenant-scoped ticket lookup. Explain why a route-only check is incomplete: a worker, test, or another service caller could invoke `updateTicket` directly.

Exercise 3, shape both response paths. Starting from the existing `ticketInclude`, create `ticketIncludeForRole(role)` so `comments` retains its order and author projection but adds `where: visibleCommentWhere(role)`. The expected predicate is `{ visibility: "PUBLIC" }` for `VIEWER` and `{}` for `ADMIN`, `MANAGER`, and `AGENT`. Use the helper in `getTicket` and in the `tx.ticket.update` include. Filtering GET alone is insufficient because a successful PATCH also returns a ticket object.

Exercise 4, write the transaction ledger for an agent request with `{ "priority": "URGENT" }`. The sequence is `authorize -> tenant lookup -> domain checks -> begin serializable transaction -> update ticket -> create AuditLog -> create OutboxEvent -> commit -> shape response`. State what is durable after a validation error, after a transaction error, and after commit. The outbox row is a durable handoff for the worker; publishing an external message before commit could announce a change that later rolls back.

Exercise 5, complete this expected-state matrix from the fixture, then compare it with `06-SOLUTIONS-AND-REVIEW.md`:

| Request and actor | Status | Ticket mutation | Audit rows | Outbox rows | Comments in response |
| --- | --- | --- | --- | --- | --- |
| Viewer `{ priority: "URGENT" }` | 403 | none | 0 | 0 | no PATCH response |
| Viewer `{ tags: ["billing"] }` | 403 | none | 0 | 0 | no PATCH response |
| Viewer `{}` | 403 | none | 0 | 0 | no PATCH response |
| Agent `{ priority: "URGENT" }` | 200 | priority changes | +1 | +1 | PUBLIC and INTERNAL |
| Viewer `GET /api/tickets/t1` | 200 | none | 0 | 0 | PUBLIC only |

Finally, state the boundary of this exercise: the demo header resolver is a local teaching fixture, not production authentication, and mocked Prisma interaction tests do not prove durable PostgreSQL counts. A disposable integration test would repeat the matrix against two tenants and inspect committed rows.
