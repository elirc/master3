import { Router } from "express";
import { createCommentSchema, createTicketSchema, ticketQuerySchema, updateTicketSchema } from "@support/shared";
import { asyncHandler } from "../../middleware/errors";
import { addTicketComment, createTicket, getTicket, listTickets, updateTicket } from "./ticketService";

export const ticketRouter = Router();

ticketRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = ticketQuerySchema.parse(req.query);
    res.json(await listTickets(req.auth!, query));
  })
);

ticketRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createTicketSchema.parse(req.body);
    res.status(201).json(await createTicket(req.auth!, input));
  })
);

ticketRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getTicket(req.auth!, String(req.params.id)));
  })
);

ticketRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = updateTicketSchema.parse(req.body);
    res.json(await updateTicket(req.auth!, String(req.params.id), input));
  })
);

ticketRouter.post(
  "/:id/comments",
  asyncHandler(async (req, res) => {
    const input = createCommentSchema.parse(req.body);
    res.status(201).json(await addTicketComment(req.auth!, String(req.params.id), input));
  })
);
