import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn()
  },
  txTicketUpdate: vi.fn(),
  txAuditCreate: vi.fn(),
  txOutboxCreate: vi.fn()
}));

vi.mock("../../apps/api/src/db", () => ({ prisma: mocks.prisma }));

const { getTicket, updateTicket } = await import("../../apps/api/src/modules/tickets/ticketService");

const viewer = {
  tenantId: "tenant-a",
  userId: "viewer-id",
  role: "VIEWER" as const,
  email: "viewer@acme.test"
};

const agent = {
  tenantId: "tenant-a",
  userId: "agent-id",
  role: "AGENT" as const,
  email: "agent@acme.test"
};

describe("ticket service authorization and response shaping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txTicketUpdate.mockResolvedValue({
      id: "ticket-1",
      status: "NEW",
      priority: "URGENT",
      slaDueAt: null,
      customer: { company: null },
      assignedUser: null,
      comments: []
    });
    mocks.txAuditCreate.mockResolvedValue({});
    mocks.txOutboxCreate.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        ticket: { update: mocks.txTicketUpdate },
        auditLog: { create: mocks.txAuditCreate },
        outboxEvent: { create: mocks.txOutboxCreate }
      }));
  });

  it.each([
    ["priority", { priority: "URGENT" as const }],
    ["tags", { tags: ["billing"] }],
    ["empty", {}]
  ])("rejects viewer %s PATCH before any Prisma lookup or transaction", async (_name, input) => {
    await expect(updateTicket(viewer, "ticket-1", input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.prisma.ticket.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets an agent update priority through the tenant-scoped transaction", async () => {
    mocks.prisma.ticket.findFirst.mockResolvedValue({
      id: "ticket-1", status: "NEW", priority: "NORMAL", assignedUserId: null
    });

    await updateTicket(agent, "ticket-1", { priority: "URGENT" });

    expect(mocks.prisma.ticket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1", tenantId: "tenant-a" }
    }));
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: expect.anything()
    }));
    expect(mocks.txTicketUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1" },
      data: expect.objectContaining({ priority: "URGENT" })
    }));
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-a", actorId: "agent-id", action: "ticket.updated" })
    }));
    expect(mocks.txOutboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-a", topic: "ticket.updated" })
    }));
  });

  it("uses public comment filtering for viewer GET responses", async () => {
    const ticket = {
      id: "ticket-1", status: "NEW", priority: "NORMAL", slaDueAt: null,
      customer: { company: null }, assignedUser: null, comments: []
    };
    mocks.prisma.ticket.findFirst.mockResolvedValue(ticket);

    await getTicket(viewer, "ticket-1");
    const viewerQuery = mocks.prisma.ticket.findFirst.mock.calls[0][0];
    expect(viewerQuery.where).toEqual({ id: "ticket-1", tenantId: "tenant-a" });
    expect(viewerQuery.include.comments.where).toEqual({ visibility: "PUBLIC" });

    mocks.prisma.ticket.findFirst.mockResolvedValue(ticket);
    await getTicket(agent, "ticket-1");
    const agentQuery = mocks.prisma.ticket.findFirst.mock.calls[1][0];
    expect(agentQuery.include.comments.where).toEqual({});
  });
});

describe("serializable transactions retry on P2034", () => {
  const serializationFailure = () =>
    new Prisma.PrismaClientKnownRequestError("could not serialize access", { code: "P2034", clientVersion: "test" });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.ticket.findFirst.mockResolvedValue({ id: "ticket-1", status: "NEW", priority: "NORMAL", assignedUserId: null });
    mocks.txTicketUpdate.mockResolvedValue({
      id: "ticket-1", status: "NEW", priority: "URGENT", slaDueAt: null, customer: { company: null }, assignedUser: null, comments: []
    });
    mocks.txAuditCreate.mockResolvedValue({});
    mocks.txOutboxCreate.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        ticket: { update: mocks.txTicketUpdate },
        auditLog: { create: mocks.txAuditCreate },
        outboxEvent: { create: mocks.txOutboxCreate }
      }));
  });

  it("retries once after a serialization failure and then succeeds", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(serializationFailure());
    await expect(updateTicket(agent, "ticket-1", { priority: "URGENT" })).resolves.toBeTruthy();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("gives up after three serialization failures and surfaces the last one", async () => {
    mocks.prisma.$transaction
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure());
    await expect(updateTicket(agent, "ticket-1", { priority: "URGENT" })).rejects.toMatchObject({ code: "P2034" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry other database errors", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" })
    );
    await expect(updateTicket(agent, "ticket-1", { priority: "URGENT" })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
