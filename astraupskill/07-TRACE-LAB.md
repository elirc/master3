# Trace lab

Trace A, forbidden viewer PATCH. The client sends `PATCH /api/tickets/t1` with `{ "priority": "URGENT" }`, `x-tenant-slug: acme-support`, and `x-user-email: viewer@acme.test`. Express routes to the ticket router. Auth queries an active user and stores tenant and role on `req.auth`. Zod parses the priority. The service enters `updateTicket`, calls `canEditTicket("VIEWER")`, and throws a 403 before its ticket query. Prisma performs no ticket read, update, audit insert, or outbox insert. The error middleware serializes `{ error: ... }`.

Trace B, operational PATCH. An agent sends `{ "tags": ["billing"] }`. Auth produces the same tenant and `AGENT` role. The role gate passes. The service selects the ticket with both id and tenant id, validates any supplied assignee or status, then opens the serializable transaction. Prisma updates tags, inserts `AuditLog(action="ticket.updated")`, inserts an `OutboxEvent(topic="ticket.updated")`, and commits. The service’s include is `ticketIncludeForRole("AGENT")`, so the 200 response includes the operational comment set and enriched SLA state.

Trace C, viewer GET. The viewer sends `GET /api/tickets/t1`. `getTicket` uses `ticketIncludeForRole("VIEWER")`; its comments predicate is `visibility = PUBLIC`. The ticket and customer are returned, the public comment remains, and the internal note is absent. This is the same policy shape used by the update include, even though a viewer cannot currently reach update. Keeping one helper prevents the two response paths from drifting again.

Trace D, cross-tenant id. For an operational actor, a valid ticket id from tenant B is sent with tenant A headers. The service's `findFirst` includes `tenantId: auth.tenantId`, so it returns no row and throws 404. The client cannot infer whether the id exists in another tenant. For a `VIEWER`, the new role gate runs first and returns 403 before any lookup; do not describe that case as a cross-tenant 404. Record each trace as actor, tenant, input, first query, durable writes, response, and visible comments. Compare the ledger with [03-WORKED-CHANGE.md](03-WORKED-CHANGE.md) and inspect [schema.prisma](../prisma/schema.prisma) for the foreign-key context.

## Where traces A, B and D diverge

All three traces enter the same function, `apps/api/src/modules/tickets/ticketService.ts:168`. The role gate runs before the lookup (trace A stops here with 403), and the lookup is tenant-scoped (trace D gets 404 for another tenant's id).

```ts
export async function updateTicket(auth: AuthContext, id: string, input: UpdateTicketInput) {
  // Ticket edits are an operational action. Keep this check before the lookup
  // so a viewer cannot trigger a database read, audit row, or outbox event by
  // sending a partial or empty PATCH.
  if (!canEditTicket(auth.role)) {
    throw new HttpError(403, "You do not have permission to update tickets");
  }

  const existing = await prisma.ticket.findFirst({
    where: { id, tenantId: auth.tenantId },
    select: { id: true, status: true, priority: true, assignedUserId: true }
  });

  if (!existing) throw new HttpError(404, "Ticket not found");
```

