# Feature Plan: RBAC And Tenant Isolation

## Goal

Ensure that support data is scoped to a tenant and that role checks are enforced by the backend.

## Impacted Areas

- `apps/api/src/middleware/auth.ts`
- `apps/api/src/modules/tickets/ticketService.ts`
- `apps/api/src/modules/admin/adminRoutes.ts`
- `packages/domain/src/index.ts`
- `prisma/schema.prisma`

## Implementation Approach

Resolve the actor once in middleware, store a small auth context on the request, and require services to use `auth.tenantId` in database queries. Keep reusable permission helpers in the domain package so tests can protect them.

## Design Considerations

Frontend role checks can improve UX, but they are not security. The API must reject unauthorized actions even if a user bypasses the UI.

## Build Journal

### What Was Built

Demo auth resolves users by tenant slug and email. Ticket listing, detail, creation, updates, customer listing, and audit logs all scope data by tenant. Admin audit logs require manager or admin roles.

### How It Connects

The middleware produces `req.auth`, and service modules consume that context. The Prisma schema includes `tenantId` on the operational tables so isolation is represented directly in the model.

### Lessons For A Growing Developer

Authorization is not a single if statement. It is a habit across data modeling, query construction, service design, and tests.

### Tradeoffs And Future Improvements

The current role model is coarse. A future version should add permission grants, teams, queue membership, and tests that prove cross-tenant records cannot be accessed.
