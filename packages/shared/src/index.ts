import { z } from "zod";

export const idSchema = z.string().min(1);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const ticketQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedUserId: z.string().optional(),
  tag: z.string().optional()
});

export const createTicketSchema = z.object({
  customerId: idSchema,
  subject: z.string().min(3).max(180),
  description: z.string().min(1).max(5000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  tags: z.array(z.string().min(1).max(32)).default([])
});

export const updateTicketSchema = z.object({
  status: z.enum(["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedUserId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).optional()
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  visibility: z.enum(["PUBLIC", "INTERNAL"])
});

export type TicketQuery = z.infer<typeof ticketQuerySchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
