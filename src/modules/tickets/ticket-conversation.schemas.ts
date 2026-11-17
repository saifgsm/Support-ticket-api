import { z } from "zod";

// OpenAI fournit une seule propriété texte; le service contrôle aussi son contenu
// après parsing avant de l'enregistrer comme commentaire.
export const ticketConversationResponseSchema = z.object({
  content: z.string(),
});

export type TicketConversationResponse = z.infer<typeof ticketConversationResponseSchema>;
