# Feature Plan: Search, Filtering, And SLA

## Goal

Give agents practical queue controls and make SLA state visible in both API responses and the frontend.

## Impacted Areas

- `packages/domain/src/index.ts`
- `packages/shared/src/index.ts`
- `apps/api/src/modules/tickets/ticketService.ts`
- `apps/web/src/App.tsx`

## Implementation Approach

Use shared query validation for filters, Prisma queries for search and tag/status/priority filters, and a domain helper to calculate SLA state from ticket snapshots.

## Design Considerations

Queue behavior should start simple but stay extensible. The current filtering approach can later evolve into saved views or full-text search without changing the basic API shape.

## Build Journal

### What Was Built

The ticket list supports search, status, priority, assignment, tag, page, and page size parameters at the API layer. The frontend exposes search, status, and priority controls. SLA state is computed consistently by the domain helper.

### How It Connects

The shared schema validates query parameters before they reach the service. The service queries Prisma and enriches ticket responses with `slaState`. The frontend renders badges from that API state.

### Lessons For A Growing Developer

Filtering is a contract, not just UI state. Good systems validate and name the query shape so future screens and API consumers can reuse it.

### Tradeoffs And Future Improvements

Database `contains` search is adequate for a first version. A larger system should add full-text indexes, saved filters, stable sorting, and cursor pagination.
