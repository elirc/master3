import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { calculateSlaDueAt } from "@support/domain";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme-support" },
    update: {},
    create: { name: "Acme Support", slug: "acme-support" }
  });

  const [admin, manager, agent, viewer] = await Promise.all([
    prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: "admin@acme.test" } },
      update: {},
      create: { tenantId: tenant.id, name: "Avery Admin", email: "admin@acme.test", role: "ADMIN" }
    }),
    prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: "manager@acme.test" } },
      update: {},
      create: { tenantId: tenant.id, name: "Morgan Manager", email: "manager@acme.test", role: "MANAGER" }
    }),
    prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: "agent@acme.test" } },
      update: {},
      create: { tenantId: tenant.id, name: "Jordan Agent", email: "agent@acme.test", role: "AGENT" }
    }),
    prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: "viewer@acme.test" } },
      update: {},
      create: { tenantId: tenant.id, name: "Viv Viewer", email: "viewer@acme.test", role: "VIEWER" }
    })
  ]);

  const company = await prisma.company.create({
    data: {
      tenantId: tenant.id,
      name: "Northstar Labs",
      domain: "northstar.example",
      plan: "enterprise"
    }
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      companyId: company.id,
      name: "Casey Rivera",
      email: "casey@northstar.example",
      phone: "+1-555-0104"
    }
  });

  const createdAt = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      assignedUserId: agent.id,
      number: 1001,
      subject: "Cannot export monthly compliance report",
      description: "The export button spins for several minutes and then fails with a generic error.",
      priority: "HIGH",
      status: "OPEN",
      tags: ["exports", "compliance", "enterprise"],
      slaDueAt: calculateSlaDueAt(createdAt, "HIGH")
    }
  });

  await prisma.ticketComment.createMany({
    data: [
      {
        tenantId: tenant.id,
        ticketId: ticket.id,
        authorId: agent.id,
        visibility: "INTERNAL",
        body: "Likely related to the report worker timeout. Check recent deploy logs before replying."
      },
      {
        tenantId: tenant.id,
        ticketId: ticket.id,
        authorId: manager.id,
        visibility: "PUBLIC",
        body: "Thanks for the report. We are investigating the export failure and will update you shortly."
      }
    ]
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorId: admin.id,
      action: "seed.initialized",
      entity: "Tenant",
      entityId: tenant.id,
      metadata: { users: [admin.email, manager.email, agent.email, viewer.email] }
    }
  });

  console.log(`Seeded tenant ${tenant.slug} with ticket #${ticket.number}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
