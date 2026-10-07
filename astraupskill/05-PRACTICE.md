# Practice exercises

Each exercise has a **Goal** (what to work out by reading code) and a **Check** (a `node:test` file you run to confirm your answer). Checks need no `npm install`: save each one anywhere outside the repo and run it from the repo root with

```bash
node --experimental-strip-types --test path/to/check.test.mjs
```

(Node 22.6 or newer.) Domain checks import the real `packages/domain/src/index.ts`; service checks read source text because the service needs Prisma. Every check below was run against the current code and passes. Write your prediction down **before** running it.

Shared header for every check file:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const d = await import(pathToFileURL(process.cwd() + "/packages/domain/src/index.ts").href);
const read = (p) => readFileSync(process.cwd() + "/" + p, "utf8");
const svc = read("apps/api/src/modules/tickets/ticketService.ts");
const body = (name) => { const i = svc.indexOf(`export async function ${name}(`); const j = svc.indexOf("\nexport ", i + 1); return svc.slice(i, j === -1 ? undefined : j); };
```

## Exercise 1: the transition matrix

**Goal:** from `packages/domain/src/index.ts:24-37` alone, predict `canTransitionTicket` for: AGENT OPEN→CLOSED, MANAGER OPEN→CLOSED, AGENT PENDING→CLOSED, ADMIN NEW→CLOSED, ADMIN CLOSED→RESOLVED, MANAGER RESOLVED→PENDING, VIEWER OPEN→OPEN, VIEWER NEW→OPEN. Explain the one that surprises you.

**Check:**

```js
test("transition matrix", () => {
  const t = (from, to, actorRole) => d.canTransitionTicket({ from, to, actorRole });
  assert.equal(t("OPEN", "CLOSED", "AGENT"), false);
  assert.equal(t("OPEN", "CLOSED", "MANAGER"), true);
  assert.equal(t("PENDING", "CLOSED", "AGENT"), true);
  assert.equal(t("NEW", "CLOSED", "ADMIN"), false);
  assert.equal(t("CLOSED", "RESOLVED", "ADMIN"), false);
  assert.equal(t("RESOLVED", "PENDING", "MANAGER"), false);
  assert.equal(t("OPEN", "OPEN", "VIEWER"), true);
  assert.equal(t("NEW", "OPEN", "VIEWER"), false);
});
```

## Exercise 2: SLA boundaries, and what "paused" means

**Goal:** for an URGENT ticket due at 12:00:00.000Z, give the `getSlaState` result at 10:59:59.999, 11:00:00.000, 12:00:00.000 and 12:00:00.001 (status OPEN), and at 15:00 with status PENDING. Then: a HIGH ticket created 09:00 waits on the customer (PENDING) until 18:00 and is reopened. What state does the agent see the moment it reopens? Find the code that would have to change for "paused" to really stop the clock.

**Check:**

```js
test("SLA boundaries", () => {
  const due = new Date("2026-01-01T12:00:00.000Z");
  const s = (iso, status = "OPEN") => d.getSlaState(new Date(iso), { status, priority: "URGENT", dueAt: due });
  assert.equal(s("2026-01-01T10:59:59.999Z"), "MET");
  assert.equal(s("2026-01-01T11:00:00.000Z"), "AT_RISK");
  assert.equal(s("2026-01-01T12:00:00.000Z"), "AT_RISK");
  assert.equal(s("2026-01-01T12:00:00.001Z"), "BREACHED");
  assert.equal(s("2026-01-01T15:00:00.000Z", "PENDING"), "PAUSED");
  assert.equal(d.getSlaState(new Date(), { status: "NEW", priority: "LOW", dueAt: null }), "MET");
});

test("pause is a label, not a clock stop", () => {
  const due = d.calculateSlaDueAt(new Date("2026-01-01T09:00:00Z"), "HIGH"); // 17:00
  const later = new Date("2026-01-01T18:00:00Z");
  assert.equal(d.getSlaState(later, { status: "PENDING", priority: "HIGH", dueAt: due }), "PAUSED");
  assert.equal(d.getSlaState(later, { status: "OPEN", priority: "HIGH", dueAt: due }), "BREACHED");
});
```

## Exercise 3: the gate and the shaped response

**Goal:** prove from source that in `updateTicket` the role gate precedes the first Prisma call, and that both `getTicket` and the transactional update use `ticketIncludeForRole`. Then fill in this matrix for seeded ticket #1001 (one PUBLIC, one INTERNAL comment):

| request and actor | status | audit rows | outbox rows | comments returned |
| --- | --- | --- | --- | --- |
| viewer PATCH `{ "priority": "URGENT" }` | ? | ? | ? | ? |
| viewer PATCH `{}` | ? | ? | ? | ? |
| agent PATCH `{ "priority": "URGENT" }` | ? | ? | ? | ? |
| viewer GET | ? | ? | ? | ? |

**Check:**

```js
test("gate before lookup, role-shaped include on both paths", () => {
  const u = body("updateTicket");
  assert.ok(u.indexOf("canEditTicket(auth.role)") > -1);
  assert.ok(u.indexOf("canEditTicket(auth.role)") < u.indexOf("prisma.ticket.findFirst"));
  assert.match(u, /tx\.ticket\.update\([\s\S]*include: ticketIncludeForRole\(auth\.role\)/);
  assert.match(body("getTicket"), /include: ticketIncludeForRole\(auth\.role\)/);
});
```

Compare your matrix with the one in [06](06-SOLUTIONS-AND-REVIEW.md).

## Exercise 4: find the 500

**Goal:** an agent PATCHes a NEW ticket with `{ "status": "CLOSED" }`. Trace it through `assertTicketTransition` (`packages/domain/src/index.ts:39-43`) and `errorMiddleware` (`apps/api/src/middleware/errors.ts:21-34`). What status code and body does the client get? Sketch a fix that keeps the domain package free of HTTP types.

**Check:**

```js
test("invalid transition surfaces as a 500 with the raw message", () => {
  let err;
  try { d.assertTicketTransition({ from: "NEW", to: "CLOSED", actorRole: "AGENT" }); } catch (e) { err = e; }
  assert.ok(err instanceof Error);
  assert.equal(err.status, undefined); // not an HttpError
  assert.equal(err.message, "Cannot transition ticket from NEW to CLOSED");
  assert.match(read("apps/api/src/middleware/errors.ts"), /res\.status\(500\)\.json\(\{ error: message \}\)/);
});
```

## Exercise 5: which writes are protected against concurrency?

**Goal:** list every place a ticket number is computed as "highest + 1". For each, say whether it runs under Serializable with a retry. Predict what two simultaneous `POST /api/notifications/inbound-email` calls for the same tenant return, naming the schema constraint involved.

**Check:**

```js
test("only the service paths retry", () => {
  assert.match(body("createTicket"), /withSerializableRetry\(/);
  assert.match(body("updateTicket"), /withSerializableRetry\(/);
  assert.doesNotMatch(body("addTicketComment"), /withSerializableRetry|isolationLevel/);
  const n = read("apps/api/src/modules/notifications/notificationRoutes.ts");
  assert.doesNotMatch(n, /withSerializableRetry|isolationLevel|requireRole|canEditTicket/);
  assert.match(n, /\(lastTicket\?\.number \?\? 1000\) \+ 1/);
  assert.match(read("prisma/schema.prisma"), /@@unique\(\[tenantId, number\]\)/);
});
```

## Exercise 6: a read the transaction does not cover

**Goal:** in `updateTicket`, locate the read that `assertTicketTransition` uses and the line where the transaction opens. Construct two concurrent agent requests on a NEW ticket, each individually legal, whose combined result is a status sequence `allowedTransitions` forbids. Explain why `Serializable` does not prevent it, and name two ways to close the gap.

**Check:**

```js
test("transition is validated against a read outside the transaction", () => {
  const u = body("updateTicket");
  const lookup = u.indexOf("prisma.ticket.findFirst");
  const assertAt = u.indexOf("assertTicketTransition");
  const txAt = u.indexOf("prisma.$transaction");
  assert.ok(lookup < assertAt && assertAt < txAt);
  const tx = u.slice(txAt);
  assert.doesNotMatch(tx, /findFirst|findUnique/); // nothing re-read inside
  assert.match(tx, /where: \{ id \}/);              // update keyed on id only
});
```

## Exercise 7: from demo identity to admin

**Goal:** you are signed in as `viewer@acme.test`. Using only endpoints in `apps/api/src/modules/admin/adminRoutes.ts` and the behaviour of `authMiddleware`, describe how you would read the audit log you are forbidden to see. Which single missing line makes the first step possible, and why does adding it not fix the underlying problem?

**Check:**

```js
test("user list is ungated; audit log is gated; identity is a header", () => {
  const a = read("apps/api/src/modules/admin/adminRoutes.ts");
  const users = a.slice(a.indexOf('"/users"'), a.indexOf('"/audit-logs"'));
  assert.doesNotMatch(users, /requireRole/);
  assert.match(a.slice(a.indexOf('"/audit-logs"')), /requireRole\(\["ADMIN", "MANAGER"\]\)/);
  assert.match(read("apps/api/src/middleware/auth.ts"), /x-user-email"\) \?\? "agent@acme\.test"/);
});
```
