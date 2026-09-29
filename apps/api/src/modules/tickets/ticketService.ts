import { Prisma } from "@prisma/client";
import {
  assertTicketTransition,
  calculateSlaDueAt,
  canAssignTicket,
  canEditTicket,
  getSlaState
} from "@support/domain";
import type { CreateCommentInput, CreateTicketInput, TicketQuery, UpdateTicketInput } from "@support/shared";
import { prisma } from "../../db";
import type { AuthContext } from "../../middleware/auth";
import { HttpError } from "../../middleware/errors";

const SERIALIZATION_FAILURE = "P2034";

/**
 * Serializable transactions are allowed to fail with a serialization error when two of them
 * touch the same rows; PostgreSQL expects the caller to retry. Without this wrapper the
 * isolation level is a promise the code cannot keep under contention: the second writer
 * would surface a 500. HttpErrors and every other failure pass through untouched.
 */
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


const ticketInclude = {
  customer: { include: { company: true } },
  assignedUser: { select: { id: true, name: true, email: true, role: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true, email: true, role: true } } }
  }
};

export function visibleCommentWhere(role: AuthContext["role"]) {
  return role === "VIEWER" ? { visibility: "PUBLIC" as const } : {};
}

function ticketIncludeForRole(role: AuthContext["role"]) {
  return {
    ...ticketInclude,
    comments: {
      where: visibleCommentWhere(role),
      orderBy: { createdAt: "asc" as const },
      include: { author: { select: { id: true, name: true, email: true, role: true } } }
    }
  };
}

function enrichTicket<T extends { slaDueAt: Date | null; status: string; priority: string }>(ticket: T) {
  return {
    ...ticket,
    slaState: getSlaState(new Date(), {
      status: ticket.status as never,
      priority: ticket.priority as never,
      dueAt: ticket.slaDueAt
    })
  };
}

export async function listTickets(auth: AuthContext, query: TicketQuery) {
  const where: Prisma.TicketWhereInput = {
    tenantId: auth.tenantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.search
      ? {
          OR: [
            { subject: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
            { customer: { name: { contains: query.search, mode: "insensitive" } } },
            { customer: { email: { contains: query.search, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        customer: { include: { company: true } },
        assignedUser: { select: { id: true, name: true, email: true, role: true } }
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    prisma.ticket.count({ where })
  ]);

  return { items: items.map(enrichTicket), total, page: query.page, pageSize: query.pageSize };
}

export async function getTicket(auth: AuthContext, id: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: auth.tenantId },
    include: ticketIncludeForRole(auth.role)
  });

  if (!ticket) throw new HttpError(404, "Ticket not found");
  return enrichTicket(ticket);
}

export async function createTicket(auth: AuthContext, input: CreateTicketInput) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, tenantId: auth.tenantId },
    select: { id: true }
  });
  if (!customer) throw new HttpError(404, "Customer not found");

  const createdAt = new Date();

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lastTicket = await tx.ticket.findFirst({
      where: { tenantId: auth.tenantId },
      orderBy: { number: "desc" },
      select: { number: true }
    });

    const ticket = await tx.ticket.create({
      data: {
        tenantId: auth.tenantId,
        customerId: input.customerId,
        number: (lastTicket?.number ?? 1000) + 1,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        tags: input.tags,
        slaDueAt: calculateSlaDueAt(createdAt, input.priority)
      },
      include: ticketInclude
    });

    await tx.auditLog.create({
      data: {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: "ticket.created",
        entity: "Ticket",
        entityId: ticket.id,
        metadata: { number: ticket.number, priority: ticket.priority }
      }
    });

    await tx.outboxEvent.create({
      data: {
        tenantId: auth.tenantId,
        topic: "ticket.created",
        payload: { ticketId: ticket.id, number: ticket.number, subject: ticket.subject }
      }
    });

    return enrichTicket(ticket);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateTicket(auth: AuthContext, id: string, input: UpdateTicketInput) {
  // Ticket edits are an operational action. Keep this check before the lookup
  // so a viewer cannot trigger a database read, audit row, or outbox event by
  // sending a partial or empty PATCH.
  if (!canEditTicket(auth.role)) {
    throw new HttpError(403, "You do not have permission to update tickets");
  }

  const existing = await prisma.ticket.findFirst({
    where: { id, tenantId: auth.tenantId },
    select: { id: true, status: true, priority: true, assignedUserId: true }
  });

  if (!existing) throw new HttpError(404, "Ticket not found");

  if (input.status) {
    assertTicketTransition({ from: existing.status, to: input.status, actorRole: auth.role });
  }

  if (input.assignedUserId !== undefined && !canAssignTicket(auth.role)) {
    throw new HttpError(403, "You do not have permission to assign tickets");
  }

  if (input.assignedUserId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assignedUserId, tenantId: auth.tenantId, active: true },
      select: { id: true }
    });
    if (!assignee) throw new HttpError(404, "Assignee not found");
  }

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id },
      data: {
        status: input.status,
        priority: input.priority,
        assignedUserId: input.assignedUserId,
        tags: input.tags,
        resolvedAt: input.status === "RESOLVED" ? new Date() : undefined,
        slaDueAt:
          input.priority && input.priority !== existing.priority
            ? calculateSlaDueAt(new Date(), input.priority)
            : undefined
      },
      include: ticketIncludeForRole(auth.role)
    });

    await tx.auditLog.create({
      data: {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: "ticket.updated",
        entity: "Ticket",
        entityId: id,
        metadata: { before: existing, after: input }
      }
    });

    await tx.outboxEvent.create({
      data: {
        tenantId: auth.tenantId,
        topic: "ticket.updated",
        payload: { ticketId: id, status: updated.status, assignedUserId: updated.assignedUserId }
      }
    });

    return enrichTicket(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function addTicketComment(auth: AuthContext, ticketId: string, input: CreateCommentInput) {
  if (auth.role === "VIEWER" && input.visibility === "INTERNAL") {
    throw new HttpError(403, "Viewers cannot create internal notes");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: auth.tenantId },
    select: { id: true, firstResponseAt: true }
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  return prisma.$transaction(async (tx) => {
    const comment = await tx.ticketComment.create({
      data: {
        tenantId: auth.tenantId,
        ticketId,
        authorId: auth.userId,
        visibility: input.visibility,
        body: input.body
      },
      include: { author: { select: { id: true, name: true, email: true, role: true } } }
    });

    if (input.visibility === "PUBLIC" && !ticket.firstResponseAt) {
      await tx.ticket.update({ where: { id: ticketId }, data: { firstResponseAt: new Date() } });
    }

    await tx.auditLog.create({
      data: {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: input.visibility === "PUBLIC" ? "ticket.public_reply_added" : "ticket.internal_note_added",
        entity: "Ticket",
        entityId: ticketId,
        metadata: { commentId: comment.id }
      }
    });

    if (input.visibility === "PUBLIC") {
      await tx.outboxEvent.create({
        data: {
          tenantId: auth.tenantId,
          topic: "notification.customer_reply",
          payload: { ticketId, commentId: comment.id }
        }
      });
    }

    return comment;
  });
}
