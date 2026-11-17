import { z } from "zod";

import { ticketCategorySchema } from "./tickets.schemas.js";

// Le même schéma Zod sert à demander une sortie structurée au SDK et à valider
// une dernière fois la réponse avant son enregistrement ou son renvoi.
export const ticketAiResponseSchema = z.object({
  is_it_related: z.boolean(),
  category: ticketCategorySchema,
  summary: z.string(),
  possible_cause: z.string().nullable(),
  resolution_steps: z.array(z.string()),
  customer_response: z.string(),
  needs_more_information: z.boolean(),
  needs_human: z.boolean(),
});

export type TicketAiResponse = z.infer<typeof ticketAiResponseSchema>;
