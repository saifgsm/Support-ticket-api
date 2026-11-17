import type { RequestHandler, Response } from "express";

import { ApiError } from "../errors.js";
import type {
  CreateTicketInput,
  ListTicketsQuery,
  TicketIdParams,
  UpdateTicketStatusInput,
} from "../modules/tickets/tickets.schemas.js";
import * as ticketService from "../services/tickets.service.js";
import { ticketAiService } from "../services/ticket-ai.service.js";
import { sendSuccess } from "../utils/http-response.js";

// Ces petits helpers lisent les informations préparées avant le contrôleur :
// le corps par Zod et l'identité par le middleware d'authentification.
function getValidatedBody<T>(response: Response): T {
  return response.locals.validatedBody as T;
}

function getAuthenticatedUser(request: Parameters<RequestHandler>[0]) {
  if (!request.user) throw new ApiError(401, "Authentification requise.");
  return request.user;
}

function getRouteId(response: Response): string {
  return (response.locals.validatedParams as TicketIdParams).id;
}

export const listTickets: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req);
  // Le service applique les filtres, le tri, la pagination et le périmètre du rôle.
  const result = await ticketService.listTickets(
    user.id,
    user.role,
    res.locals.validatedQuery as ListTicketsQuery,
  );
  sendSuccess(res, result.items, 200, result.pagination);
};

export const createTicket: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req);
  // L'identifiant du créateur vient de req.user, donc du token vérifié, pas du JSON.
  const ticket = await ticketService.createTicket(
    user.id,
    getValidatedBody<CreateTicketInput>(res),
  );
  sendSuccess(res, ticket, 201);
};

export const getTicket: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req);
  sendSuccess(res, await ticketService.getTicket(getRouteId(res), user.id, user.role));
};

export const updateTicketStatus: RequestHandler = async (req, res) => {
  const ticket = await ticketService.updateTicketStatus(
    getRouteId(res),
    getValidatedBody<UpdateTicketStatusInput>(res),
  );
  sendSuccess(res, ticket);
};

export function createGenerateAiResponseHandler(
  aiService: Pick<typeof ticketAiService, "createDraft"> = ticketAiService,
): RequestHandler {
  return async (req, res) => {
    const user = getAuthenticatedUser(req);
    const draft = await aiService.createDraft(getRouteId(res), user.id, user.role);
    sendSuccess(res, draft, 201);
  };
}

export const generateAiResponse = createGenerateAiResponseHandler();
