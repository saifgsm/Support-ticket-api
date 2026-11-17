import { z } from "zod";

import { ticketIdParamsSchema } from "./tickets.schemas.js";

export const ticketCommentParamsSchema = ticketIdParamsSchema;

export const createTicketCommentSchema = z.object({
  content: z.string().trim().min(1, "Le commentaire ne peut pas être vide.").max(4000),
});

export type CreateTicketCommentInput = z.infer<typeof createTicketCommentSchema>;
export type TicketCommentParams = z.infer<typeof ticketCommentParamsSchema>;
