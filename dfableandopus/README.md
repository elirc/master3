# Master3 support desk interview kit

Master3 is a multi-tenant support desk: a TypeScript modular monolith with an Express API (`apps/api`), a pure rules package (`packages/domain`), Prisma over PostgreSQL, an outbox worker (`apps/worker`) and a Vite frontend. The astraupskill course follows one ticket from request to row to response. This folder turns that into hiring material for CRUD backend roles.

## The pitch

"I own the ticket slice of a multi-tenant support desk. Two rules drive everything. First, authorization happens at the service boundary, before the database is touched: a viewer's PATCH is refused in the first three lines of `updateTicket`, so it cannot cause a lookup, an audit row or an outbox event. Second, visibility shapes the response on every path, not just on GET. Internal notes were being filtered out of ticket reads but included in the object returned from a PATCH, which is a leak on the write path; the same role-aware include is now used by both. Every accepted ticket create or update writes the row, an audit record and an outbox event inside one `Serializable` transaction, and I added the retry wrapper that isolation level requires, because without it the second concurrent writer surfaces a 500 instead of retrying."

## Target stack

Node, TypeScript, Express, Prisma, PostgreSQL, Vitest, with a polling outbox worker. The patterns translate to ASP.NET Core with EF Core: `$transaction` with `Serializable` becomes a transaction scope with `IsolationLevel.Serializable`, and the P2034 retry becomes a check on PostgreSQL SQLSTATE 40001.

## Two-week plan

- Days 1-2: [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md) screening group, with `apps/api/src/modules/tickets/ticketService.ts` open next to it.
- Days 3-5: deep-dive group. You should be able to say why the role gate precedes the lookup, and why `canTransitionTicket` special-cases agents closing tickets, without prompting.
- Days 6-7: [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md), timed.
- Days 8-9: [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md). The retry wrapper and the PATCH leak are the two stories with real evidence behind them.
- Days 10-12: [04-TAKE-HOME.md](04-TAKE-HOME.md), using the existing mocked service suite.
- Day 13: [05-SYSTEM-DESIGN-FOLLOWUPS.md](05-SYSTEM-DESIGN-FOLLOWUPS.md).
- Day 14: [06-FLASHCARDS.md](06-FLASHCARDS.md).

## What the evidence actually says

The recorded run is 17 unit tests passing (`npx vitest run`), including the three retry cases in `tests/api/ticket-service.test.ts:109-150`, with the integration file skipped, plus `npm run typecheck` at exit 0. `tests/integration/ticket-patch.int.test.ts` runs only when `TEST_DATABASE_URL` is set; against a disposable PostgreSQL 18 it passed two cases: three viewer PATCH shapes leave audit and outbox counts unchanged while an agent PATCH adds exactly one of each, and a ticket id belonging to another tenant is a 404.

The unit suite mocks `prisma` entirely (`tests/api/ticket-service.test.ts:15`), so it proves call order, arguments, query shape and retry counts, and nothing about rollback, locking or durability. Answers in this folder that touch those name which suite backs them.

The auth headers are a teaching fixture. `authMiddleware` resolves `x-tenant-slug` and `x-user-email` against the database with no credential check (`apps/api/src/middleware/auth.ts:19-31`); say so in an interview before anyone has to ask.
