# Codebase map

## Files that matter (line counts from `wc -l`)

| file | lines | owns |
| --- | ---: | --- |
| `apps/api/src/app.ts` | 25 | middleware order: CORS, JSON, `/api/health` (no auth), then `authMiddleware` on all other `/api` routes, then routers, then `errorMiddleware` |
| `apps/api/src/middleware/auth.ts` | 57 | demo-header identity (`authMiddleware`) and `requireRole` |
| `apps/api/src/middleware/errors.ts` | 34 | `HttpError`, `asyncHandler`, `errorMiddleware` (Zod → 400, HttpError → its status, anything else → 500) |
| `apps/api/src/modules/tickets/ticketRoutes.ts` | 45 | five ticket endpoints; Zod parse, then call the service |
| `apps/api/src/modules/tickets/ticketService.ts` | 289 | list, get, create, update, comment; retry wrapper; response shaping |
| `apps/api/src/modules/customers/customerRoutes.ts` | 46 | customer search and companies, Prisma called straight from the route |
| `apps/api/src/modules/notifications/notificationRoutes.ts` | 79 | simulated inbound email that creates a ticket |
| `apps/api/src/modules/admin/adminRoutes.ts` | 32 | user list and audit-log list |
| `packages/domain/src/index.ts` | 85 | pure rules: transitions, SLA math, role helpers |
| `packages/shared/src/index.ts` | 41 | Zod wire schemas and their inferred types |
| `prisma/schema.prisma` | 193 | 9 models, 5 enums |
| `apps/worker/src/worker.ts` | 44 | outbox polling loop |
| `apps/web/src/App.tsx` | 405 | the whole UI, including a user switcher |

There is no `migrations/` folder: the schema is applied with `prisma db push` or a first `prisma migrate dev`.

## The ticket PATCH pipeline

Follow `PATCH /api/tickets/:id` with these line numbers open:

1. `app.ts:17` runs `authMiddleware` for every `/api` path registered after it. `auth.ts:23-26` finds an **active** user by email *and* tenant slug; no row means 401 (`auth.ts:28-31`).
2. `ticketRoutes.ts:34` parses the body with `updateTicketSchema` (`packages/shared/src/index.ts:26-31`). Every field is optional, so `{}` is valid input. A bad enum throws `ZodError`, which `errors.ts:22-24` turns into 400.
3. `ticketService.ts:172` checks `canEditTicket(auth.role)` **before** anything else: a viewer gets 403 and Prisma is never called.
4. `ticketService.ts:176-181` loads the ticket with `{ id, tenantId: auth.tenantId }`. Another tenant's id is indistinguishable from a missing id: 404.
5. `ticketService.ts:183-197` validates a requested status transition against the row just read, and a requested assignee against the same tenant with `active: true`.
6. `ticketService.ts:199-236` runs one serializable transaction: update the ticket, insert `AuditLog(action="ticket.updated")`, insert `OutboxEvent(topic="ticket.updated")`, wrapped in `withSerializableRetry` (`:22-31`).
7. The update's `include` is `ticketIncludeForRole(auth.role)` (`:213`), so the returned comments obey the same visibility rule as `getTicket` (`:108`). `enrichTicket` (`:58-67`) adds the derived `slaState`.

The worker never talks to the API. It polls `OutboxEvent` directly through the API's Prisma client (`worker.ts:2`, `:7-11`), logs each event and marks it processed.

## Where the boundaries are uneven

The ticket module is the only one with a service layer. Customers, notifications and admin call Prisma from the route handler, so rules that live in `ticketService.ts` (role gate, retry, audit row) do not automatically apply there. The inbound-email route creates tickets with its own copy of the numbering logic (`notificationRoutes.ts:33-43`) rather than calling `createTicket`. [06](06-SOLUTIONS-AND-REVIEW.md) lists what that costs.
