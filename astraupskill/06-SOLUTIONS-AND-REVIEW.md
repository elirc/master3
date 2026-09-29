# Solutions and review

Exercise 1 solution: `x-tenant-slug: acme-support` is resolved to the synthetic database id `tenant-a`, while `x-user-email: viewer@acme.test` resolves to an active user whose role is `VIEWER`. The body `{ priority: "URGENT" }` is valid at the route boundary. `updateTicket` then calls `canEditTicket("VIEWER")`, throws `HttpError(403, ...)`, and returns through the error middleware before `prisma.ticket.findFirst`. The same path applies to `{ tags: ["billing"] }` and `{}`. Because no lookup, transaction, ticket update, audit insert, or outbox insert is reached, each has zero durable side effects. This is a service authorization result, not a claim that the demo headers are production identity.

Exercise 2 solution: the complete helper is:

```ts
export function canEditTicket(role: ActorRole): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "AGENT";
}
```

`canAssignTicket` delegates to the same accepted set today, but it remains a separate name for validating assignment. `updateTicket` calls `canEditTicket(auth.role)` before `prisma.ticket.findFirst`; the route still parses JSON with Zod, and Zod owns priority enum validation. The service receives typed input and should not be described as the priority parser. A route-only gate would leave direct service callers unprotected.

Exercise 3 solution: `ticketIncludeForRole(role)` preserves the customer, assigned-user, comment ordering, and author projection from `ticketInclude`, then sets `comments.where` to `visibleCommentWhere(role)`. That predicate is `{ visibility: "PUBLIC" }` for `VIEWER` and `{}` for each operational role. `getTicket` passes this include to `prisma.ticket.findFirst`; `updateTicket` passes the same role-aware include to `tx.ticket.update`. The original defect filtered GET while returning an unfiltered PATCH result. The repair makes response shaping a shared policy. `createTicket` has no new role gate in this increment; its existing route/service behavior stays outside the PATCH authorization change.

Here is the complete helper from `ticketService.ts`, using that file's existing
`AuthContext` import and `ticketInclude` declaration:

```ts
export function visibleCommentWhere(role: AuthContext["role"]) {
  return role === "VIEWER" ? { visibility: "PUBLIC" as const } : {};
}

function ticketIncludeForRole(role: AuthContext["role"]) {
  return {
    ...ticketInclude,
    comments: {
      where: visibleCommentWhere(role),
      orderBy: { createdAt: "asc" as const },
      include: { author: { select: { id: true, name: true, email: true, role: true } } }
    }
  };
}
```

The complete read call is `prisma.ticket.findFirst({ where: { id, tenantId:
auth.tenantId }, include: ticketIncludeForRole(auth.role) })`. In the existing
transaction's `tx.ticket.update` call, keep its `where` and `data` unchanged
and set `include: ticketIncludeForRole(auth.role)`. These are two distinct use
sites: one shapes a read response, the other shapes the record returned by a
successful write. The mocked tests inspect the generated Prisma query; they
do not pretend that mocked empty comment arrays demonstrate actual database
filtering. The viewer is rejected before the write use site is reachable.

Exercise 4 solution: the operational path is `authorize -> tenant lookup -> domain checks -> begin serializable transaction -> update ticket -> AuditLog -> OutboxEvent -> commit -> response`. Validation happens before transaction writes. A validation error leaves the database unchanged and never creates audit or outbox rows. A transaction failure rolls back all durable writes made by that transaction. Here the important boundary is the Prisma commit: an outbox row is durable only after commit, and the worker can retry it. Sending a webhook before commit could expose a notification for a change that later rolls back.

Exercise 5 mapped answer:

| Request and actor | Response | Ticket mutation | Audit | Outbox | Returned comments |
| --- | --- | --- | --- | --- | --- |
| Viewer PATCH `{ priority: "URGENT" }` | 403 | none | 0 | 0 | no PATCH body |
| Viewer PATCH `{ tags: ["billing"] }` | 403 | none | 0 | 0 | no PATCH body |
| Viewer PATCH `{}` | 403 | none | 0 | 0 | no PATCH body |
| Agent PATCH `{ priority: "URGENT" }` | 200 | priority becomes URGENT | +1 `ticket.updated` | +1 event | PUBLIC and INTERNAL |
| Viewer GET `/api/tickets/t1` | 200 | none | 0 | 0 | PUBLIC only |

The staged `tests/api/ticket-service.test.ts` invokes the actual `getTicket` and `updateTicket` functions with a mocked Prisma module. It asserts the viewer 403 happens before lookup and `$transaction`, the agent lookup includes both `id: "ticket-1"` and `tenantId: "tenant-a"`, and viewer versus agent GET uses the two comment predicates. These are meaningful interaction checks, but they do not prove committed row counts or HTTP middleware behavior. A follow-up disposable PostgreSQL test should seed tenants A and B, send the same five requests, reopen a fresh client, and assert the matrix against durable AuditLog and OutboxEvent rows. Reviewers should also preserve the nullable `assignedUserId` wire contract in any future extension: omitted means unchanged, `null` means clear, and a non-null id must be tenant-scoped before mutation.
