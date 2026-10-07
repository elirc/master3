# Worked change: safe ticket PATCH

The "before" code is preserved in `snapshots/`. Diff it yourself against the current files; every claim below comes from that diff.

```bash
git diff --no-index astraupskill/snapshots/ticketService-before.ts.txt apps/api/src/modules/tickets/ticketService.ts
git diff --no-index astraupskill/snapshots/domain-before.ts.txt packages/domain/src/index.ts
git diff --no-index astraupskill/snapshots/ticket-rules-before.ts.txt tests/domain/ticket-rules.test.ts
```

`snapshots/ticketRoutes-before.ts.txt` is byte-identical to the current `ticketRoutes.ts`: the routes did not change, which is itself the lesson (the fix belongs in the service).

## Two symptoms, one cause

**Predict before you read on:** name the two symptoms; is the missing check in the route or the service?

In the snapshot, `updateTicket` opened with the tenant-scoped `findFirst`, and the only role-sensitive checks were conditional on fields:

- `status` present: `assertTicketTransition` refused a viewer, but by throwing a plain `Error`, so the client got a **500**, not a 403 (`packages/domain/src/index.ts:39-43`, `errors.ts:32-33`).
- `assignedUserId` present: `canAssignTicket` gave a proper 403.
- anything else (`priority`, `tags`, or `{}`): no check at all. A viewer could raise priority, and the write produced an audit row and an outbox event.

The second symptom was the response. The snapshot's update used `include: ticketInclude`, whose comments have no visibility filter, while `getTicket` filtered inline. A viewer's harmless-looking PATCH returned internal notes that a viewer GET hid.

One cause: the PATCH was treated as a bag of independently checked fields instead of one operation that needs authority and a shaped response.

## The role gate comes first

**Predict before you read on:** why must the gate run before `findFirst` and not after?

```ts
// ticketService.ts:172-174
if (!canEditTicket(auth.role)) {
  throw new HttpError(403, "You do not have permission to update tickets");
}
```

Placed after the lookup, a viewer would still learn whether an id exists in their tenant (404 vs 403) and would cost a query. Placed first, every viewer PATCH is a 403 with zero database work. `canEditTicket` is new in the domain package (`index.ts:82-85`); `canAssignTicket` now delegates to it (`:78-80`) but keeps its name so assignment callers read correctly.

## The response is shaped by role

**Predict before you read on:** what changes for an agent, and what changes for a viewer, when `ticketInclude` becomes `ticketIncludeForRole`?

For an agent, nothing: `visibleCommentWhere("AGENT")` is `{}`. For a viewer, the update path is now unreachable, but the include is still role-aware, so if the gate is ever loosened (say, to let viewers tag tickets) the response stays safe. `ticketIncludeForRole` (`ticketService.ts:47-56`) replaced the inline filter in `getTicket` and the raw include in `updateTicket`, so the two paths cannot drift again.

## What arrived in later passes

The diff also shows changes that are not part of the PATCH repair: `withSerializableRetry` (`:14-31`), and `{ isolationLevel: Serializable }` on both the `createTicket` and `updateTicket` transactions (`:165`, `:236`). The snapshot's transactions used the default isolation level (Read Committed in PostgreSQL). Keep the two changes separate in your head: the gate and the include fix authorization; the isolation level and retry address concurrent writers, and only partly (02, "Serializable means retry").

## Walk the three requests

**Predict before you read on:** for viewer PATCH, agent PATCH and viewer GET on seeded ticket #1001, write the status code and the number of audit rows created.

- Viewer `PATCH {"priority":"URGENT"}`: auth resolves `viewer@acme.test`; Zod accepts; `canEditTicket("VIEWER")` is false → 403. No lookup, no audit row, no outbox row.
- Agent `PATCH {"priority":"URGENT"}`: tenant-scoped lookup finds the HIGH ticket; no status or assignee to check; transaction updates priority, recomputes `slaDueAt` from *now* because the priority changed (`:208-211`), inserts one audit row and one outbox row → 200 with both comments.
- Viewer `GET`: 200 with the manager's public reply and without the agent's internal note (the seed creates one of each, `prisma/seed.ts:72-89`).

## What the patch leaves alone

`createTicket` still has no role gate, so a viewer can open tickets through `POST /api/tickets` and through `POST /api/notifications/inbound-email`. `addTicketComment` still lets a viewer post a public reply. Invalid transitions by an operational role are still 500s. Whether those are bugs is a product decision; [06](06-SOLUTIONS-AND-REVIEW.md) argues the last one is.
