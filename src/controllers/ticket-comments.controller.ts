import type { RequestHandler, Response } from "express";

import { ApiError } from "../errors.js";
import type {
  CreateTicketCommentInput,
  TicketCommentParams,
} from "../modules/tickets/ticket-comments.schemas.js";
import { ticketCommentsService } from "../services/ticket-comments.service.js";
import { sendSuccess } from "../utils/http-response.js";

function getAuthenticatedUser(request: Parameters<RequestHandler>[0]) {
  if (!request.user) throw new ApiError(401, "Authentification requise.");
  return request.user;
}

function getValidatedParams(response: Response): TicketCommentParams {
  return response.locals.validatedParams as TicketCommentParams;
}

function getValidatedBody(response: Response): CreateTicketCommentInput {
  return response.locals.validatedBody as CreateTicketCommentInput;
}

export function createTicketCommentsController(
  service: Pick<typeof ticketCommentsService, "listComments" | "addComment"> = ticketCommentsService,
) {
  return {
    listComments: (async (req, res) => {
      const user = getAuthenticatedUser(req);
      const { id } = getValidatedParams(res);
      sendSuccess(res, await service.listComments(id, user.id, user.role));
    }) satisfies RequestHandler,

    createComment: (async (req, res) => {
      const user = getAuthenticatedUser(req);
      const { id } = getValidatedParams(res);
      const { content } = getValidatedBody(res);
      const result = await service.addComment(id, user.id, user.role, content);
      sendSuccess(res, result, 201);
    }) satisfies RequestHandler,
  };
}

export const ticketCommentsController = createTicketCommentsController();
