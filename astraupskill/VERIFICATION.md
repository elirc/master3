# Verification record

Master3 passed the root `npm run verify` script: TypeScript compilation, fourteen Vitest tests in two files, and the Vite production build. The final process exited zero. The build transformed the React application and emitted production assets. This verification used installed local dependencies and did not contact PostgreSQL or a production service. The earlier nine-test result covered only domain helpers; the final fourteen include the actual service interaction regressions.

The source change is bounded to ticket CRUD policy. `updateTicket` now rejects non-operational roles before the first Prisma query, which covers priority-only, tags-only, statusless, and empty PATCH bodies. The returned update uses a role-aware comment include. `getTicket` retains public-only comments for viewers. `canEditTicket` is covered alongside existing transition, assignment, and internal-note helpers. The 14-test suite includes nine pure domain tests and five mocked-Prisma service interaction tests. Exact originals are in [ticketService-before.ts.txt](snapshots/ticketService-before.ts.txt), [ticketRoutes-before.ts.txt](snapshots/ticketRoutes-before.ts.txt), [domain-before.ts.txt](snapshots/domain-before.ts.txt), and [ticket-rules-before.ts.txt](snapshots/ticket-rules-before.ts.txt).

Reviewers should inspect tenant predicates in `ticketService.ts`, especially ticket and assignee lookups, and confirm that audit and outbox writes remain inside `$transaction`. The mocked service checks prove call ordering and query shape, but do not prove committed PostgreSQL counts, HTTP middleware, or worker delivery. The verify command also does not turn demo header identity into production authentication. Those are explicit follow-up boundaries. The current evidence proves the source compiles, all 14 bounded tests execute, and the web bundle builds from the staged code. Keep any future database test disposable, seed two tenants, and assert both forbidden side effects and comment visibility.

When extending this change, rerun verification after executable source changes. The course examples intentionally name synthetic users, tenants, ticket ids, and comments so a learner can reproduce the reasoning without exposing private data. The exercise's tenant-a/t1 fixture is a proposed synthetic mapping; the service mocks use ticket-1 and supply the AuthContext directly. Neither should be mistaken for automatically seeded rows in an existing database.

## Run it yourself

```powershell
docker compose up -d                          # PostgreSQL on localhost:5432 (support/support, db support_desk)
Copy-Item .env.example .env                   # DATABASE_URL points at that container
npm install
npx prisma migrate dev                        # or: npx prisma db push
npm run seed                                  # tenant acme-support, viewer@acme.test, agent@acme.test, ticket t1
npm run dev                                   # API + web + worker; the API listens on the port printed in the terminal (see apps/api)
```

Then, with the API port in `$port` and a ticket id from the seed output in `$ticket`:

```powershell
# viewer PATCH -> 403, no audit row, no outbox event
curl -i -X PATCH "http://localhost:$port/api/tickets/$ticket" -H "content-type: application/json" -H "x-tenant-slug: acme-support" -H "x-user-email: viewer@acme.test" -d '{"priority":"URGENT"}'
# agent PATCH -> 200, one ticket.updated audit row, one outbox event, comments filtered for the agent
curl -i -X PATCH "http://localhost:$port/api/tickets/$ticket" -H "content-type: application/json" -H "x-tenant-slug: acme-support" -H "x-user-email: agent@acme.test" -d '{"priority":"URGENT"}'
```

Check the rows with `npx prisma studio` or `SELECT action, count(*) FROM "AuditLog" GROUP BY 1;`.

## Repeat and inspect the recorded run

From the project root, run:

```powershell
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Installation failed' }
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }
```

The final [command record](evidence/verify-06.json) preserves the absolute Node/npm launcher used on Windows, timestamps, working directory and exit status. The [raw output](evidence/verify-06.log) records fourteen passing tests and the successful build. The [installation record](evidence/install-01.json) documents the normal dependency setup. Earlier command attempts included launcher failures and a run whose process disappeared before build completion; those records remain in the central history and are not counted as successful final verification.

Read the service test as a boundary test: the three viewer inputs fail before lookup or transaction; the permitted agent input reaches the tenant-filtered lookup and expected ticket, audit and outbox calls; viewer and agent GET calls use different comment predicates. The mocked transaction executes the callback but cannot demonstrate PostgreSQL locking or rollback. To test those properties, add a separate disposable database fixture and inspect committed rows with an independent client. No browser, real notification worker, deployment or production identity provider was exercised in this verification.
