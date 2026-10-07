# Code reading drill: Master3 support desk

Six drills for a 45-minute screen share. Excerpts are copied from this repository unless the drill says otherwise. Paths are relative to the project root.

## Drill 1: explain this function

`apps/api/src/modules/tickets/ticketService.ts:22-31`

```ts
export async function withSerializableRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === SERIALIZATION_FAILURE;
      if (!retryable || attempt >= attempts) throw error;
    }
  }
}
```

Explain the loop condition, what `SERIALIZATION_FAILURE` is, and what happens to an `HttpError` thrown inside `work`.

<details>
<summary>Answer</summary>

The `for` has no termination condition because every exit is explicit: a successful `work()` returns, and any error either rethrows immediately or falls through to another attempt. The bound is `attempt >= attempts`, so three attempts total, and the error that escapes on exhaustion is the last real error rather than a synthetic one, which keeps the P2034 visible in logs.

`SERIALIZATION_FAILURE` is `"P2034"` (line 14), Prisma's code for a PostgreSQL serialization failure. Under `Serializable`, conflicting transactions are not queued; one is aborted and the application is expected to run it again, which is exactly what this wrapper supplies.

An `HttpError` fails the `instanceof` check, so `retryable` is false and it rethrows on the first pass. That is deliberate: a 403 or a 404 thrown inside the transaction is a decision, not a contention failure, and retrying it would be wasted work. `tests/api/ticket-service.test.ts:144` covers the equivalent for P2002, asserting exactly one transaction call.
</details>

## Drill 2: spot the bug

A mutated copy of the top of `updateTicket`. Two lines moved.

```ts
export async function updateTicket(auth: AuthContext, id: string, input: UpdateTicketInput) {
  const existing = await prisma.ticket.findFirst({
    where: { id, tenantId: auth.tenantId },
    select: { id: true, status: true, priority: true, assignedUserId: true }
  });

  if (!existing) throw new HttpError(404, "Ticket not found");

  if (!canEditTicket(auth.role)) {
    throw new HttpError(403, "You do not have permission to update tickets");
  }
```

<details>
<summary>Answer</summary>

The role gate moved after the lookup. In the real file it is first, at `apps/api/src/modules/tickets/ticketService.ts:172`, with a comment above it saying why.

Three consequences. A viewer now gets a 404 for an id that does not exist and a 403 for one that does, so PATCH becomes an existence oracle: an unauthorised actor can enumerate valid ticket ids from the status codes alone. Every unauthorised PATCH now costs a database query, which is a free amplification for anyone hammering the endpoint. And the refusal is no longer a pure function of the actor, so reasoning about "can a viewer cause a write" requires reading the whole handler instead of its first three lines.

The test that fails is the parameterised case at `tests/api/ticket-service.test.ts:55-63`, which sends priority, tags and `{}` as a viewer and asserts `prisma.ticket.findFirst` was never called. The empty-body case is the one that catches this even if you talked yourself into believing the lookup is harmless.
</details>

## Drill 3: predict the status code

Agent of tenant A, ticket `t-1` currently `NEW` in tenant A:

```
PATCH /api/tickets/t-1
x-tenant-slug: acme-support
x-user-email: agent@acme.test
content-type: application/json

{"status":"CLOSED"}
```

<details>
<summary>Answer</summary>

500, with body `{ "error": "Cannot transition ticket from NEW to CLOSED" }`.

Why refused: `canTransitionTicket` special-cases agents closing tickets at `packages/domain/src/index.ts:35`, allowing `to === "CLOSED"` only from `RESOLVED` or `PENDING`. `NEW` is neither, so the guard returns false before the general `allowedTransitions` table is consulted, and a manager or admin doing the same thing would fall through to the table, where `NEW` maps to `["OPEN", "PENDING", "RESOLVED"]` (line 25) and would also be refused.

Why 500 rather than 409: `assertTicketTransition` throws a plain `Error` (line 41), and `errorMiddleware` only maps `ZodError` to 400 and `HttpError` to its status, so anything else lands on the 500 branch at `apps/api/src/middleware/errors.ts:32-33` with the raw message. Naming that mismatch unprompted is the strong answer; a rule violation is a client error and the status is lying about it.

Nothing is written: the throw happens at line 184, before the transaction at line 199.
</details>

## Drill 4: predict the output

A viewer in tenant A posts a public comment on their own ticket, which has `firstResponseAt` null:

```
POST /api/tickets/t-1/comments
{"body":"any news?","visibility":"PUBLIC"}
```

What rows change, and what does an SLA dashboard show afterwards?

<details>
<summary>Answer</summary>

201 with the comment, and four writes in one transaction: the `ticketComment` row, an update setting `ticket.firstResponseAt` to now (`apps/api/src/modules/tickets/ticketService.ts:262-264`), an `auditLog` row with action `ticket.public_reply_added` (line 270), and an `outboxEvent` with topic `notification.customer_reply` (line 281).

The `firstResponseAt` stamp is the interesting part and it is arguably wrong. The only role check in this function refuses a viewer creating an `INTERNAL` note (line 240); nothing restricts who can trigger the first-response stamp. So a customer-side public comment satisfies a metric that is supposed to mean "the support team answered", and the notification event tells the outbox that a customer reply happened when the author was the customer.

Note also what does not happen: this transaction has no isolation level and is not wrapped in `withSerializableRetry`, so it runs at read-committed. Two simultaneous public comments could both observe `firstResponseAt` as null, but they write the same field to nearly the same value, so the race is benign rather than dangerous.
</details>

## Drill 5: review this diff

A teammate wants the list endpoint to be faster.

```diff
   const [items, total] = await Promise.all([
     prisma.ticket.findMany({
-      where,
+      where: { ...where, tenantId: undefined },
       include: {
         customer: { include: { company: true } },
         assignedUser: { select: { id: true, name: true, email: true, role: true } }
       },
       orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
-      skip: (query.page - 1) * query.pageSize,
-      take: query.pageSize
+      skip: (query.page - 1) * query.pageSize
     }),
-    prisma.ticket.count({ where })
+    prisma.ticket.count()
   ]);
```

<details>
<summary>Answer</summary>

Three defects, worst first.

1. `tenantId: undefined` removes the tenant predicate. In Prisma an `undefined` value drops the filter entirely rather than matching null, so this returns every tenant's tickets. This is the single worst change you can make in this codebase: tenant isolation here is application-enforced per query (`apps/api/src/modules/tickets/ticketService.ts:71`), with no row-level security underneath it, so one dropped filter is a full cross-tenant leak with nothing to catch it.
2. Dropping `take` makes the query unbounded. With `skip` still present, page 1 now returns the entire table.
3. `count()` with no `where` returns a total that does not match the filtered list, so the pagination footer lies whenever any filter is active, and it lies across tenants for the same reason as defect 1.

None of this is faster. The real answer to the performance question is keyset pagination on `(priority, updatedAt, id)` with an index to match, and dropping the unanchored `contains` search (lines 76-85) in favour of a `tsvector` or trigram index.
</details>

## Drill 6: explain this function

`apps/api/src/middleware/auth.ts:19-31`, condensed.

```ts
const tenantSlug = String(req.header("x-tenant-slug") ?? "acme-support");
const userEmail = String(req.header("x-user-email") ?? "agent@acme.test");
const user = await prisma.user.findFirst({
  where: { email: userEmail, tenant: { slug: tenantSlug }, active: true },
  select: { id: true, email: true, role: true, tenantId: true }
});
if (!user) {
  res.status(401).json({ error: "Unknown tenant or user. Seed the database or send valid auth headers." });
  return;
}
req.auth = { tenantId: user.tenantId, userId: user.id, role: user.role, email: user.email };
```

What is sound here, what is not, and how would you describe it in an interview?

<details>
<summary>Answer</summary>

Sound: the role and the tenant id both come from the stored user row, not from the request, so a caller cannot send a role directly (though, as below, they can pick which user row is selected, and `/api/admin/users` at `adminRoutes.ts:8-18` lists every email and role without a role gate). The join requires the user to belong to that tenant slug and to be `active`, so a deactivated account or a mismatched pairing is a 401, and the resulting `AuthContext` is the only thing downstream code trusts.

Not sound: there is no authentication. The email header is an unverified identity claim, and both headers default to seeded values, so a request with no headers at all resolves to a real agent in a real tenant. That is fine as a local teaching fixture and catastrophic if deployed, which is why the course README calls it out in its opening section.

How to describe it: "tenant scoping in this codebase is real and tested, and the identity that selects the tenant is a demo shim. Replacing it is a session or token check in front of this middleware; everything after it, including every `tenantId` predicate in the service, is unchanged." That answer shows you know which half is the design and which half is the fixture. The service tests never exercise this function at all, since they call the service directly with a hand-built context (`tests/api/ticket-service.test.ts:19-31`).
</details>
