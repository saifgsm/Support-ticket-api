import type { Role, TicketCategory } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { zodTextFormat } from "openai/helpers/zod";

import { getOpenAIClient, getOpenAIModel } from "../config/openai.js";
import { prisma } from "../db.js";
import { ApiError } from "../errors.js";
import { TICKET_AI_SYSTEM_PROMPT } from "../modules/tickets/ticket-ai.prompt.js";
import { ticketAiResponseSchema, type TicketAiResponse } from "../modules/tickets/ticket-ai.schemas.js";
import * as ticketService from "./tickets.service.js";

export type TicketAiInput = {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
  status: string;
};

export type SaveDraftInput = {
  ticketId: string;
  generatedById: string;
  model: string;
  response: TicketAiResponse;
};

export type TicketAiServiceDependencies = {
  model: string;
  getTicket: (id: string, userId: string, role: Role) => Promise<TicketAiInput>;
  generateResponse: (ticket: TicketAiInput, model: string) => Promise<unknown>;
  saveDraft: (input: SaveDraftInput) => Promise<unknown>;
};

async function generateStructuredResponse(ticket: TicketAiInput, model: string): Promise<unknown> {
  const aiResponse = await getOpenAIClient().responses.parse({
    model,
    // Le brouillon est conservé dans notre base; inutile de garder l'état de réponse chez OpenAI.
    store: false,
    input: [
      { role: "system", content: TICKET_AI_SYSTEM_PROMPT },
      {
        role: "user",
        // On transmet seulement les champs nécessaires, sans nom ni e-mail du client.
        content: JSON.stringify({
          title: ticket.title,
          description: ticket.description,
          category: ticket.category,
          status: ticket.status,
        }),
      },
    ],
    text: { format: zodTextFormat(ticketAiResponseSchema, "ticket_ai_response") },
  });

  // Un refus du modèle ou une réponse tronquée peut ne pas contenir de résultat parsé.
  if (aiResponse.status !== "completed" || aiResponse.output_parsed == null) {
    throw new ApiError(502, "Le service IA n'a pas fourni de réponse exploitable.");
  }
  return aiResponse.output_parsed;
}

// Fabrique injectée pour tester toute la logique avec un faux modèle et un faux
// dépôt, sans appel réseau ni dépense de crédits OpenAI.
export function createTicketAiService(dependencies: TicketAiServiceDependencies) {
  return {
    async createDraft(ticketId: string, generatedById: string, role: Role) {
      const ticket = await dependencies.getTicket(ticketId, generatedById, role);

      let modelOutput: unknown;
      try {
        modelOutput = await dependencies.generateResponse(ticket, dependencies.model);
      } catch (error) {
        if (error instanceof ApiError) throw error;

        const isTimeout = error instanceof Error && error.name === "APIConnectionTimeoutError";
        throw new ApiError(
          isTimeout ? 504 : 502,
          isTimeout
            ? "Le délai de réponse du service IA est dépassé. Réessayez plus tard."
            : "Le service IA est temporairement indisponible.",
        );
      }

      const parsed = ticketAiResponseSchema.safeParse(modelOutput);
      if (!parsed.success) {
        throw new ApiError(502, "La réponse du service IA n'a pas le format attendu.");
      }

      // La catégorie de la base est la référence : une sortie du modèle ne peut pas
      // modifier ni réattribuer la catégorie réelle du ticket.
      const response = { ...parsed.data, category: ticket.category };
      return dependencies.saveDraft({
        ticketId: ticket.id,
        generatedById,
        model: dependencies.model,
        response,
      });
    },
  };
}

export const ticketAiService = createTicketAiService({
  model: getOpenAIModel(),
  getTicket: (id, userId, role) => ticketService.getTicket(id, userId, role),
  generateResponse: generateStructuredResponse,
  saveDraft: (input) => prisma.ticketAiDraft.create({
    data: {
      ticketId: input.ticketId,
      generatedById: input.generatedById,
      model: input.model,
      response: input.response as Prisma.InputJsonValue,
    },
  }),
});
