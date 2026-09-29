# Testing and debugging

The verification command is `npm run verify`, which runs TypeScript checking, Vitest, and the Vite production build. The current evidence was captured with `npm.cmd run verify` from the staged project and exited with code 0. The domain suite has nine passing tests. Those tests exercise pure workflow and role helpers without requiring PostgreSQL, while the build checks that the service’s Prisma include types and route imports remain valid.

Start with a regression table. For `{ priority: "URGENT" }` as `VIEWER`, expect 403, zero audit rows, zero outbox rows, and no ticket update. For `{}` as `VIEWER`, expect the same result; empty partial input must not become a write. For `{ priority: "URGENT" }` as `AGENT`, expect 200 and one `ticket.updated` audit plus outbox record. For a viewer GET, expect public comments and no `INTERNAL` comment. For an agent GET or successful agent PATCH, expect both visibility values. These assertions distinguish authorization, persistence, and response shaping.

The staged verification has 14 tests: nine domain tests plus five service interaction tests. The service tests mock Prisma, invoke the real `getTicket` and `updateTicket` functions, and assert no lookup or transaction for each viewer PATCH shape, a tenant-scoped agent lookup, and the two comment predicates. They are bounded interaction evidence, not durable database or HTTP proof.

When a test fails, identify its layer. A 401 indicates tenant or active-user lookup. A 403 on an agent indicates the role gate or fixture role. A 404 may mean the ticket belongs to a different tenant for an operational actor; a viewer PATCH should be 403 before lookup. A 200 response with an internal viewer comment indicates the wrong include was used. A ticket change without matching audit and outbox rows indicates a transaction boundary problem. A passing GET test does not prove PATCH output is safe; exercise each route that embeds a ticket.

The domain test in [ticket-rules.test.ts](../tests/domain/ticket-rules.test.ts) proves `canEditTicket("VIEWER")` is false and operational roles are true. It also retains the assignment and internal-note tests, so the repair does not weaken existing policy. A future PostgreSQL integration fixture should seed two tenants, four roles, one ticket, one public comment, and one internal note, then inspect durable counts before and after forbidden requests. Keep that fixture disposable and never point it at a user database.

## The domain test that pins the role gate

This is the case referred to below, from `tests/domain/ticket-rules.test.ts:52`. It runs with no database at all, which is why it belongs in the domain suite rather than behind a Postgres fixture.

```ts
  it("allows ticket edits only for operational roles", () => {
    expect(canEditTicket("ADMIN")).toBe(true);
    expect(canEditTicket("MANAGER")).toBe(true);
    expect(canEditTicket("AGENT")).toBe(true);
    expect(canEditTicket("VIEWER")).toBe(false);
  });
```

