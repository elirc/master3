# Testing and debugging

## What the suites contain (counted from source)

`npm test` runs `vitest run` with `include: ["tests/**/*.test.ts"]` (`vitest.config.ts:7`). That glob picks up three files:

| file | tests | needs a database? | proves |
| --- | ---: | --- | --- |
| `tests/domain/ticket-rules.test.ts` | 9 | no | transition, SLA and role helpers, including `canEditTicket` (`:52-57`) |
| `tests/api/ticket-service.test.ts` | 8 (3 via `it.each` + 2 + 3) | no, Prisma is mocked at `:15` | viewer PATCH shapes stop before lookup and transaction (`:55-63`); agent path hits a tenant-scoped lookup, audit and outbox (`:65-88`); viewer vs agent comment predicates (`:90-106`); retry on `P2034` only (`:129-150`) |
| `tests/integration/ticket-patch.int.test.ts` | 2 | yes, skipped unless `TEST_DATABASE_URL` is set (`:10`) | committed audit/outbox counts and the cross-tenant 404 against real PostgreSQL |

So a plain run reports 17 passing and 2 skipped. The integration file's header comment (`:3-7`) gives the disposable-database recipe; never point `TEST_DATABASE_URL` at a database you care about, because the test creates and deletes tenants.

## What each layer can and cannot prove

The mocked service tests check call order and query shape. Their `$transaction` mock just invokes the callback (`ticket-service.test.ts:47-52`), so they cannot show rollback, locking or a real serialization failure; the retry tests inject a fake `P2034` instead. Nothing tests HTTP at all: `authMiddleware`, `errorMiddleware` and the Zod parse in the routes are exercised only by hand. The worker, the inbound-email route, customers and admin have no tests.

## Reading a failure by its status code

| you see | look at |
| --- | --- |
| 401 | `auth.ts:23-31`: wrong slug, unknown email, or `active: false` |
| 400 with `issues` | Zod in the route (`errors.ts:22-24`); the service never ran |
| 403 for an agent | `canEditTicket` / `canAssignTicket`, or the seeded role |
| 404 for an agent | tenant predicate: the id belongs to another tenant or does not exist |
| 500 "Cannot transition ticket from X to Y" | `assertTicketTransition` threw a plain `Error` (domain `index.ts:41`); this is a client mistake reported as a server fault (06, F2) |
| 500 mentioning `Unique constraint` | `P2002`: duplicate ticket number or email `externalId` (06, F4) |
| 200 with an INTERNAL comment for a viewer | an include that bypasses `ticketIncludeForRole` |
| ticket changed but no audit row | a write outside the transaction |

A passing GET test does not prove that PATCH output is safe; check every route that returns a ticket.

## The domain test that pins the role gate

From `tests/domain/ticket-rules.test.ts:52-57`. It needs no database, which is why it belongs in the domain suite:

```ts
  it("allows ticket edits only for operational roles", () => {
    expect(canEditTicket("ADMIN")).toBe(true);
    expect(canEditTicket("MANAGER")).toBe(true);
    expect(canEditTicket("AGENT")).toBe(true);
    expect(canEditTicket("VIEWER")).toBe(false);
  });
```

## Dependency-free checks

The domain package has no imports, so Node 22.6+ can load it directly with type stripping. From the repo root, with no `npm install`:

```bash
node --experimental-strip-types --test path/to/your-check.test.mjs
```

Inside the check, import the domain with `await import(pathToFileURL(process.cwd() + "/packages/domain/src/index.ts").href)`. The service cannot be loaded this way (it imports `@prisma/client` and path aliases), so the practice checks for service code read the source text instead. [05-PRACTICE.md](05-PRACTICE.md) uses both styles.
