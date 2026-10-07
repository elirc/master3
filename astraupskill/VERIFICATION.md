# Verification record

## The recorded run (frozen, 2026-09-12)

[evidence/verify-06.json](evidence/verify-06.json) records `npm run verify` (typecheck, Vitest, Vite build) exiting 0 on 2026-09-12 after 130 s. At that point the suite had 14 tests in two files: nine domain tests and five mocked-Prisma service tests. Its raw log was not committed; the JSON holds only the command, timestamps, working directory and exit status. The paths inside both evidence files are from the machine that produced them and will not exist on yours. [evidence/install-01.json](evidence/install-01.json) records the `npm ci` that preceded it.

**Note added 2026-10-06:** the repository has changed since that run. A later pass added `withSerializableRetry` with three retry tests (`tests/api/ticket-service.test.ts:109-150`) and the opt-in `tests/integration/ticket-patch.int.test.ts`. Counted from source, `vitest run` now collects 19 tests: 17 run and 2 are skipped unless `TEST_DATABASE_URL` is set. The interview pack's README reports a 17-passing run with typecheck at exit 0; no evidence file for that run is in `evidence/`. This refinement did not install dependencies or run Vitest; it ran the dependency-free checks in [05-PRACTICE.md](05-PRACTICE.md) (8 tests, all passing on Node 22.16).

## What the evidence proves and what it does not

It proves the source type-checks, the unit tests pass and the web bundle builds. It does not prove committed PostgreSQL row counts, rollback, locking, HTTP middleware behaviour or worker delivery: the service tests mock Prisma entirely (`ticket-service.test.ts:15`), and no test sends an HTTP request. The integration file covers row counts and the cross-tenant 404 when you give it a disposable database. The demo-header identity is not authentication, and nothing here changes that.

The original sources for the PATCH repair are in `snapshots/` (see [03-WORKED-CHANGE.md](03-WORKED-CHANGE.md) for how to diff them). `ticketRoutes-before.ts.txt` is identical to the current file.

## Run it yourself

```powershell
docker compose up -d postgres                # PostgreSQL 16 on localhost:5432 (support/support, db support_desk)
Copy-Item .env.example .env                  # DATABASE_URL for that container, PORT=4000
npm install
npx prisma db push                           # no migrations folder exists, so push the schema
npm run prisma:seed                          # tenant acme-support, four users, ticket #1001 with one public and one internal comment
npm run dev                                  # API on :4000, web on :5173 (proxies /api), worker
```

Find the ticket id, then try the two central requests:

```powershell
$h = @{ "x-tenant-slug" = "acme-support"; "x-user-email" = "agent@acme.test" }
$ticket = (Invoke-RestMethod http://localhost:4000/api/tickets -Headers $h).items[0].id
# viewer PATCH -> 403, no audit row, no outbox event
curl.exe -i -X PATCH "http://localhost:4000/api/tickets/$ticket" -H "content-type: application/json" -H "x-tenant-slug: acme-support" -H "x-user-email: viewer@acme.test" -d '{\"priority\":\"URGENT\"}'
# agent PATCH -> 200, one ticket.updated audit row and one outbox event, both comments returned
curl.exe -i -X PATCH "http://localhost:4000/api/tickets/$ticket" -H "content-type: application/json" -H "x-tenant-slug: acme-support" -H "x-user-email: agent@acme.test" -d '{\"priority\":\"URGENT\"}'
```

Count the rows with `npx prisma studio` or `SELECT action, count(*) FROM "AuditLog" GROUP BY 1;`. With the worker running, the outbox row moves to PROCESSED within `WORKER_POLL_INTERVAL_MS` (4000 by default).

To repeat the recorded gate: `npm ci`, `npm run prisma:generate` (CI does this first, `.github/workflows/ci.yml`), then `npm run verify`.
