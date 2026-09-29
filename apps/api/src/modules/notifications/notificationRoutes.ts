import { Router } from "express";
import { z } from "zod";
import { calculateSlaDueAt } from "@support/domain";
import { prisma } from "../../db";
import { asyncHandler } from "../../middleware/errors";

const inboundEmailSchema = z.object({
  externalId: z.string().min(1),
  fromEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

export const notificationRouter = Router();

notificationRouter.post(
  "/inbound-email",
  asyncHandler(async (req, res) => {
    const input = inboundEmailSchema.parse(req.body);
    const tenantId = req.auth!.tenantId;

    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: input.fromEmail } },
      update: {},
      create: {
        tenantId,
        email: input.fromEmail,
        name: input.fromEmail.split("@")[0]
      }
    });

    const result = await prisma.$transaction(async (tx) => {
      const lastTicket = await tx.ticket.findFirst({
        where: { tenantId },
        orderBy: { number: "desc" },
        select: { number: true }
      });

      const ticket = await tx.ticket.create({
        data: {
          tenantId,
          customerId: customer.id,
          number: (lastTicket?.number ?? 1000) + 1,
          subject: input.subject,
          description: input.body,
          priority: "NORMAL",
          tags: ["email"],
          slaDueAt: calculateSlaDueAt(new Date(), "NORMAL")
        }
      });

      const email = await tx.emailMessage.create({
        data: {
          tenantId,
          ticketId: ticket.id,
          externalId: input.externalId,
          fromEmail: input.fromEmail,
          toEmail: "support@acme.test",
          subject: input.subject,
          body: input.body,
          direction: "INBOUND",
          processedAt: new Date()
        }
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          topic: "ticket.email_ingested",
          payload: { ticketId: ticket.id, emailMessageId: email.id }
        }
      });

      return { ticket, email };
    });

    res.status(202).json(result);
  })
);
