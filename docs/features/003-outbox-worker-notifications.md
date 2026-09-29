# Feature Plan: Outbox Worker And Notifications

## Goal

Introduce a reliable boundary for asynchronous work such as customer notifications, webhooks, and integrations.

## Impacted Areas

- `prisma/schema.prisma`
- `apps/api/src/modules/tickets/ticketService.ts`
- `apps/api/src/modules/notifications/notificationRoutes.ts`
- `apps/worker/src/worker.ts`

## Implementation Approach

Create `OutboxEvent` rows in the same transaction as the domain change. Let a separate worker process poll pending events and mark them processed or failed.

## Design Considerations

An outbox avoids the classic bug where the database write succeeds but the external notification fails before the system records that it needs retrying.

## Build Journal

### What Was Built

Ticket creation, ticket updates, public replies, and inbound email ingestion create outbox events. The worker polls pending events, logs the payload, and updates processing state.

### How It Connects

The worker depends on the same Prisma client as the API but runs as a separate process. That mirrors how many modular monoliths split web and background runtimes while sharing the same codebase and database.

### Lessons For A Growing Developer

Asynchronous side effects deserve explicit state. A durable event table is easier to inspect and retry than a hidden in-memory promise chain.

### Tradeoffs And Future Improvements

The current worker uses polling and console logging. Future versions should add exponential backoff, dead-letter queues, idempotency keys, and real providers.
