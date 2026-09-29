# Architecture Journal

## 2026-05-04 - Initial System Spine

The first implementation creates the product spine rather than a toy screen. The important choice is that ticket workflow rules live in `packages/domain`, not inside React components or Express route callbacks. A junior developer should notice that this makes the rules testable without a web server or database.

The API is organized by product module: tickets, customers, notifications, and admin. The ticket module owns the highest-risk workflow because ticket updates touch status transitions, assignment, SLA, audit logging, and outbox events. That is why the route file is thin and the service file carries orchestration.

Tenant isolation is represented by `tenantId` on operational tables. The current auth layer resolves a demo user from `x-tenant-slug` and `x-user-email`, then every module uses `req.auth.tenantId`. This is not production authentication, but it teaches the correct data-access habit: queries should be scoped by tenant as close to the persistence layer as possible.

The outbox table was added early because notifications and integrations are common places where enterprise apps become unreliable. Creating the ticket and event in one transaction means the worker can be retried independently without losing the fact that something happened.

The frontend is intentionally dense and workflow-oriented. It is not a marketing page. The first screen is the working queue because support agents live in queues, filters, details, status changes, and replies.

## 2026-05-04 - Verification Discipline

The first tests cover ticket transition rules, SLA state, and authorization helpers. These tests do not prove the whole app works, but they protect the rules most likely to create product bugs when future features arrive.

CI runs typecheck, tests, and build. Database-backed integration tests are deferred until migrations are stabilized, because the first local setup should remain approachable.
