import type { Role } from "@prisma/client";

import { prisma } from "../db.js";
import { ApiError } from "../errors.js";
import { ticketUuidSchema } from "../modules/tickets/tickets.schemas.js";
import { ticketConversationAiService } from "./ticket-conversation-ai.service.js";

export const MAX_USER_COMMENTS_PER_TICKET = 20;

type TicketConversationResponder = Pick<typeof ticketConversationAiService, "generateReply">;

export function createTicketCommentsService(
  conversationAi: TicketConversationResponder = ticketConversationAiService,
) {
  async function authorizeOwner(ticketId: string, userId: string, role: Role) {
    if (role !== "USER") throw new ApiError(403, "Seul le propriétaire du ticket peut accéder à la conversation.");

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, createdById: true, status: true },
    });
    if (!ticket) throw new ApiError(404, "Ticket introuvable.");
    if (ticket.createdById !== userId) {
      throw new ApiError(403, "Seul le propriétaire du ticket peut accéder à la conversation.");
    }
    return ticket;
  }

  function parseTicketId(idInput: string): string {
    const parsedId = ticketUuidSchema.safeParse(idInput);
    if (!parsedId.success) throw new ApiError(400, "ID invalide.");
    return parsedId.data;
  }

  return {
    async listComments(idInput: string, userId: string, role: Role) {
      const ticketId = parseTicketId(idInput);
      await authorizeOwner(ticketId, userId, role);

      return prisma.comment.findMany({
        where: { ticketId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, content: true, type: true, createdAt: true, aiStatus: true },
      });
    },

    async addComment(idInput: string, userId: string, role: Role, content: string) {
      const ticketId = parseTicketId(idInput);
      if (role !== "USER") throw new ApiError(403, "Seul le propriétaire du ticket peut commenter.");

      // Le verrou sur la ligne Ticket rend atomiques la vérification du statut,
      // de la génération en cours et du quota avec l'insertion du commentaire.
      const userComment = await prisma.$transaction(async (tx) => {
        const lockedTickets = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId}::uuid FOR UPDATE
        `;
        if (lockedTickets.length === 0) throw new ApiError(404, "Ticket introuvable.");

        const ticket = await tx.ticket.findUnique({
          where: { id: ticketId },
          select: { createdById: true, status: true },
        });
        if (!ticket) throw new ApiError(404, "Ticket introuvable.");
        if (ticket.createdById !== userId) {
          throw new ApiError(403, "Seul le propriétaire du ticket peut commenter.");
        }
        if (ticket.status === "closed") {
          throw new ApiError(409, "Un ticket fermé ne peut plus recevoir de commentaire.");
        }

        const activeGeneration = await tx.comment.findFirst({
          where: { ticketId, type: "USER", aiStatus: "PROCESSING" },
          select: { id: true },
        });
        if (activeGeneration) {
          throw new ApiError(409, "Une réponse IA est déjà en cours pour ce ticket.");
        }

        const userCommentCount = await tx.comment.count({
          where: { ticketId, type: "USER" },
        });
        if (userCommentCount >= MAX_USER_COMMENTS_PER_TICKET) {
          throw new ApiError(409, "La limite de 20 commentaires utilisateur est atteinte.");
        }

        return tx.comment.create({
          data: {
            content: content.trim(),
            type: "USER",
            ticketId,
            authorId: userId,
            aiStatus: "PROCESSING",
          },
          select: { id: true, content: true, type: true, createdAt: true, aiStatus: true },
        });
      });

      try {
        const replyContent = await conversationAi.generateReply(ticketId);
        const normalizedReply = replyContent.trim();
        if (normalizedReply.length === 0 || normalizedReply.length > 4000) {
          throw new ApiError(502, "La réponse du service IA n'a pas le format attendu.");
        }

        return await prisma.$transaction(async (tx) => {
          const aiReply = await tx.comment.create({
            data: {
              content: normalizedReply,
              type: "AI",
              ticketId,
              replyToId: userComment.id,
            },
            select: { id: true, content: true, type: true, createdAt: true, aiStatus: true },
          });
          const completedUserComment = await tx.comment.update({
            where: { id: userComment.id },
            data: { aiStatus: "COMPLETED" },
            select: { id: true, content: true, type: true, createdAt: true, aiStatus: true },
          });
          return { userComment: completedUserComment, aiReply };
        });
      } catch (error) {
        await prisma.comment.update({
          where: { id: userComment.id },
          data: { aiStatus: "FAILED" },
        });
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "La réponse automatique n'a pas pu être générée.");
      }
    },
  };
}

export const ticketCommentsService = createTicketCommentsService();
