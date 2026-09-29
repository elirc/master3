import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a disposable PostgreSQL with the schema pushed:
//   docker run --rm -d -e POSTGRES_PASSWORD=local-test -p 5433:5432 postgres:18
//   $env:TEST_DATABASE_URL = "postgresql://postgres:local-test@127.0.0.1:5433/postgres"
//   $env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma db push
//   npx vitest run tests/integration
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ticket PATCH against a real database", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let svc: typeof import("../../apps/api/src/modules/tickets/ticketService");
  let tenantA: string, tenantB: string, ticketId: string, viewerId: string, agentId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasources: { db: { url } } });
    svc = await import("../../apps/api/src/modules/tickets/ticketService");
    const stamp = Date.now().toString(36);
    const a = await prisma.tenant.create({ data: { name: "A " + stamp, slug: "int-a-" + stamp } });
    const b = await prisma.tenant.create({ data: { name: "B " + stamp, slug: "int-b-" + stamp } });
    tenantA = a.id; tenantB = b.id;
    const viewer = await prisma.user.create({ data: { tenantId: tenantA, name: "Viewer", email: "viewer@" + stamp, role: "VIEWER" } });
    const agent = await prisma.user.create({ data: { tenantId: tenantA, name: "Agent", email: "agent@" + stamp, role: "AGENT" } });
    viewerId = viewer.id; agentId = agent.id;
    const customer = await prisma.customer.create({ data: { tenantId: tenantA, name: "C", email: "c@" + stamp } });
    const ticket = await prisma.ticket.create({ data: { tenantId: tenantA, customerId: customer.id, number: 1001, subject: "s", description: "d" } });
    ticketId = ticket.id;
    await prisma.ticketComment.createMany({ data: [
      { tenantId: tenantA, ticketId, authorId: agent.id, visibility: "PUBLIC", body: "public" },
      { tenantId: tenantA, ticketId, authorId: agent.id, visibility: "INTERNAL", body: "internal" },
    ] });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.ticketComment.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.ticket.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  const counts = async () => ({
    audit: await prisma.auditLog.count({ where: { tenantId: tenantA } }),
    outbox: await prisma.outboxEvent.count({ where: { tenantId: tenantA } }),
  });

  it("three viewer PATCH shapes write nothing; an agent PATCH writes exactly one audit row and one outbox event", async () => {
    const viewer = { tenantId: tenantA, userId: viewerId, role: "VIEWER" as const, email: "v" };
    const agent = { tenantId: tenantA, userId: agentId, role: "AGENT" as const, email: "a" };
    const before = await counts();
    for (const input of [{ priority: "URGENT" as const }, { tags: ["billing"] }, {}]) {
      await expect(svc.updateTicket(viewer, ticketId, input)).rejects.toMatchObject({ status: 403 });
      expect(await counts()).toEqual(before);
    }
    const updated = await svc.updateTicket(agent, ticketId, { priority: "URGENT" });
    expect(updated.priority).toBe("URGENT");
    expect(updated.comments.map((c: { visibility: string }) => c.visibility).sort()).toEqual(["INTERNAL", "PUBLIC"]);
    const after = await counts();
    expect(after).toEqual({ audit: before.audit + 1, outbox: before.outbox + 1 });
  });

  it("a ticket id from another tenant is a 404 for an agent of tenant A", async () => {
    const other = await prisma.customer.create({ data: { tenantId: tenantB, name: "O", email: "o@" + tenantB } });
    const foreign = await prisma.ticket.create({ data: { tenantId: tenantB, customerId: other.id, number: 1001, subject: "f", description: "f" } });
    const agent = { tenantId: tenantA, userId: agentId, role: "AGENT" as const, email: "a" };
    await expect(svc.updateTicket(agent, foreign.id, { priority: "LOW" })).rejects.toMatchObject({ status: 404 });
  });
});
