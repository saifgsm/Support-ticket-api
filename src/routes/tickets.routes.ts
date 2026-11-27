import { Router } from "express";

import { requireAuthentication, requireRoles } from "../middlewares/auth.middleware.js";
import * as ticketController from "../controllers/tickets.controller.js";
import * as ticketCommentsController from "../controllers/ticket-comments.controller.js";
import { validateBody, validateParams, validateQuery } from "../modules/validation/validate-body.js";
import {
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamsSchema,
  updateTicketStatusSchema,
} from "../modules/tickets/tickets.schemas.js";
import { createTicketCommentSchema, ticketCommentParamsSchema } from "../modules/tickets/ticket-comments.schemas.js";
import { createRateLimiter } from "../utils/rate-limit.js";

const ticketAiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Trop de demandes de génération IA. Réessayez plus tard.",
});

export function createTicketRouter(
  aiResponseHandler: typeof ticketController.generateAiResponse = ticketController.generateAiResponse,
  commentsController: Pick<typeof ticketCommentsController.ticketCommentsController, "listComments" | "createComment"> = ticketCommentsController.ticketCommentsController,
): Router {
  const router = Router();

  // Tous les tickets sont privés : même la lecture et la création nécessitent
  // d'abord un access token valide.
  router.use(requireAuthentication);
  router.get("/", validateQuery(listTicketsQuerySchema), ticketController.listTickets);
  router.post("/", validateBody(createTicketSchema), ticketController.createTicket);
  router.get(
    "/:id/comments",
    requireRoles("USER"),
    validateParams(ticketCommentParamsSchema),
    commentsController.listComments,
  );
  router.post(
    "/:id/comments",
    requireRoles("USER"),
    validateParams(ticketCommentParamsSchema),
    validateBody(createTicketCommentSchema),
    commentsController.createComment,
  );
  router.get("/:id", validateParams(ticketIdParamsSchema), ticketController.getTicket);
  router.patch(
    "/:id/status",
    // Un utilisateur normal peut consulter/créer ses tickets, mais seuls les rôles
    // de support peuvent changer leur état.
    requireRoles("SUPER_ADMIN", "ADMIN", "AGENT"),
    validateParams(ticketIdParamsSchema),
    validateBody(updateTicketStatusSchema),
    ticketController.updateTicketStatus,
  );
  router.post(
    "/:id/ai-response",
    requireRoles("SUPER_ADMIN", "ADMIN", "AGENT", "USER"),
    validateParams(ticketIdParamsSchema),
    ticketAiLimiter,
    aiResponseHandler,
  );
  return router;
}

export const ticketRouter = createTicketRouter();
