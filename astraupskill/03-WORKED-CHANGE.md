# Worked change: safe ticket PATCH

## Two symptoms, one cause

## Two symptoms, one cause

## Two symptoms, one cause

**Predict before you read on:** name the two symptoms before reading; is the missing check in the route or the service?

**Predict before you read on:** name the two symptoms before reading; is the missing check in the route or the service?

## The role gate comes first

**Predict before you read on:** why must the gate run before `findFirst` and not after?

**Predict before you read on:** name the two symptoms before reading; is the missing check in the route or the service?

## The role gate comes first

## The response is shaped by role

**Predict before you read on:** what changes for an agent, and what changes for a viewer, when `ticketInclude` becomes `ticketIncludeForRole`?

**Predict before you read on:** why must the gate run before `findFirst` and not after?

## Walk the three requests

**Predict before you read on:** for viewer PATCH, agent PATCH and viewer GET, write the status code and the number of audit rows created.

The defect has two visible symptoms. A viewer can send `PATCH /api/tickets/t1` with `{ "priority": "URGENT" }` because the service only checks role when `status` or `assignedUserId` is present. A viewer can also receive an internal comment because the update query includes the shared `ticketInclude`, while GET replaces its comments include with a public-only predicate. Both symptoms come from treating a partial update as a collection of independent fields instead of one authorized operation with a shaped response.

## The role gate comes first

## The response is shaped by role

## What the patch leaves alone

**Predict before you read on:** does `createTicket` get a role gate in this change? Why might that be deferred?

**Predict before you read on:** what changes for an agent, and what changes for a viewer, when `ticketInclude` becomes `ticketIncludeForRole`?

**Predict before you read on:** why must the gate run before `findFirst` and not after?

## Walk the three requests

**Predict before you read on:** for viewer PATCH, agent PATCH and viewer GET, write the status code and the number of audit rows created.

The repair starts with a role gate:

```ts
if (!canEditTicket(auth.role)) {
  throw new HttpError(403, "You do not have permission to update tickets");
}
```

## The response is shaped by role

## What the patch leaves alone

**Predict before you read on:** does `createTicket` get a role gate in this change? Why might that be deferred?

**Predict before you read on:** what changes for an agent, and what changes for a viewer, when `ticketInclude` becomes `ticketIncludeForRole`?

It runs before `prisma.ticket.findFirst`. The service keeps its existing tenant-scoped lookup, transition check, assignee check, and serializable transaction. The route's Zod schema validates the priority enum before this service receives typed input; the service is not the priority parser. The update include changes from `ticketInclude` to `ticketIncludeForRole(auth.role)`. That helper keeps the customer and assigned-user projections but adds `where: visibleCommentWhere(role)` to comments. An agent therefore sees public and internal notes; a viewer cannot reach update, while viewer GET still sees public notes only.

## Walk the three requests

**Predict before you read on:** for viewer PATCH, agent PATCH and viewer GET, write the status code and the number of audit rows created.

Walk the viewer request. Auth resolves the viewer in tenant `acme-support`. Zod accepts the priority. `updateTicket` rejects the role before querying Prisma, so the result is 403. There is no updated ticket, audit row, or outbox event. Walk the agent request. Auth resolves `agent@acme.test`; the service loads the ticket in the same tenant, checks any supplied status or assignee rules, updates it in a transaction, creates `ticket.updated`, and returns 200. The response contains the agent-allowed comment set. Walk a viewer GET after that change: it still returns the ticket's public comment and omits the internal note.

## What the patch leaves alone

**Predict before you read on:** does `createTicket` get a role gate in this change? Why might that be deferred?

The patch preserves status transition and assignment rules. `canAssignTicket` still governs assignee validation, while `canEditTicket` expresses the broader operational edit rule. `createTicket` has no new role gate in this change; its existing behavior is outside the PATCH defect. Demo header authentication remains intentionally bounded to local fixtures; production identity verification is a separate design.
