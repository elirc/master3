# Trace lab

For each trace, record: actor, tenant, input, first query, durable writes, response, visible comments. `$id` is the cuid of seeded ticket #1001 (get it from `GET /api/tickets` as the agent; the seed prints only the number, `prisma/seed.ts:102`).

**Trace A, forbidden viewer PATCH.** `PATCH /api/tickets/$id`, `{ "priority": "URGENT" }`, `x-tenant-slug: acme-support`, `x-user-email: viewer@acme.test`. `authMiddleware` reads the active user (`auth.ts:23-26`); the route's Zod parse accepts (`ticketRoutes.ts:34`); `updateTicket` calls `canEditTicket("VIEWER")` and throws 403 (`ticketService.ts:172-174`). First query: the auth lookup only. Writes: none. Response: `403 {"error":"You do not have permission to update tickets"}`.

**Trace B, operational PATCH.** Same request as the agent with `{ "tags": ["billing"] }`. The gate passes; `findFirst` with `{ id, tenantId }` (`:176-179`); no status or assignee to validate; the serializable transaction updates tags, inserts `AuditLog(action="ticket.updated")` and `OutboxEvent(topic="ticket.updated")` (`:199-233`). `slaDueAt` is untouched because priority did not change. Response: 200 with both comments and `slaState`.

**Trace C, viewer GET.** `getTicket` uses `ticketIncludeForRole("VIEWER")` (`:105-113`), whose comment predicate is `visibility = PUBLIC`. Response: 200 with the manager's public reply, without the agent's internal note.

**Trace D, cross-tenant id.** An agent of `acme-support` sends an id belonging to another tenant. `findFirst` includes `tenantId: auth.tenantId`, finds nothing, throws 404 (`:181`). A *viewer* sending the same id gets 403 from the gate before any lookup; do not describe that as a cross-tenant 404.

**Trace E, invalid transition.** The agent sends `{ "status": "CLOSED" }` on an OPEN ticket. `assertTicketTransition` (`packages/domain/src/index.ts:39-43`) throws a plain `Error` because AGENT may close only from RESOLVED or PENDING (`:35`). `errorMiddleware` falls through to 500 (`errors.ts:32-33`). Writes: none. Response: `500 {"error":"Cannot transition ticket from OPEN to CLOSED"}`. Same request as the manager: 200.

**Trace F, inbound email as a viewer.** `POST /api/notifications/inbound-email` with `{ "externalId": "m-1", "fromEmail": "new@example.com", "subject": "Hi", "body": "Help" }` as `viewer@acme.test`. No role check runs (`notificationRoutes.ts:16-20`). The customer is upserted outside the transaction (`:22-30`); inside, the route computes the next number, creates the ticket, the `EmailMessage` and an `OutboxEvent(topic="ticket.email_ingested")` (`:32-75`). No audit row. Response: 202. Send the identical body again: the customer upsert is a no-op, then the `EmailMessage` insert hits `@@unique([tenantId, externalId])` and the transaction rolls back. Response: 500 (finding F4).

## Where traces A, B, D and E diverge

All four enter `updateTicket` (`apps/api/src/modules/tickets/ticketService.ts:168`):

```ts
  if (!canEditTicket(auth.role)) {                       // A stops here: 403
    throw new HttpError(403, "You do not have permission to update tickets");
  }

  const existing = await prisma.ticket.findFirst({
    where: { id, tenantId: auth.tenantId },              // D misses here
    select: { id: true, status: true, priority: true, assignedUserId: true }
  });

  if (!existing) throw new HttpError(404, "Ticket not found");   // D: 404

  if (input.status) {
    assertTicketTransition({ from: existing.status, to: input.status, actorRole: auth.role }); // E: 500
  }
```

B is the only one to reach the transaction at `:199`.
