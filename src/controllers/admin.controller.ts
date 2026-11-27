import type { RequestHandler, Response } from "express";

import { ApiError } from "../errors.js";
import type {
  AuditLogQuery,
  CreateUserInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
} from "../modules/admin/admin.schemas.js";
import * as adminService from "../services/admin.service.js";
import { sendSuccess } from "../utils/http-response.js";

// Les contrôleurs font le lien entre Express et les services : ils lisent les
// entrées préparées par les middleware, appellent un service et choisissent la réponse HTTP.
function getValidatedBody<T>(response: Response): T {
  // Cette valeur est écrite par validateBody(schema) dans la route juste avant.
  return response.locals.validatedBody as T;
}

function getAuthenticatedUserId(request: Parameters<RequestHandler>[0]): string {
  if (!request.user) throw new ApiError(401, "Authentification requise.");
  return request.user.id;
}

function getRouteId(response: Response): string {
  const id = (response.locals.validatedParams as { id: string } | undefined)?.id;
  if (!id) throw new ApiError(400, "ID utilisateur invalide.");
  return id;
}

export const listUsers: RequestHandler = async (_req, res) => {
  sendSuccess(res, await adminService.listUsers());
};

export const createUser: RequestHandler = async (req, res) => {
  // 201 signifie que la ressource a été créée; le contrôleur ne crée pas lui-même
  // les données, il délègue cette règle métier au service.
  const result = await adminService.createUser(
    getValidatedBody<CreateUserInput>(res),
    getAuthenticatedUserId(req),
  );
  sendSuccess(res, result, 201);
};

export const resendInvitation: RequestHandler = async (req, res) => {
  sendSuccess(res, await adminService.resendInvitation(getRouteId(res), getAuthenticatedUserId(req)));
};

export const updateUserStatus: RequestHandler = async (req, res) => {
  const result = await adminService.updateUserStatus(
    getRouteId(res),
    getAuthenticatedUserId(req),
    getValidatedBody<UpdateUserStatusInput>(res),
  );
  sendSuccess(res, result);
};

export const updateUserRole: RequestHandler = async (req, res) => {
  const result = await adminService.updateUserRole(
    getRouteId(res),
    getAuthenticatedUserId(req),
    getValidatedBody<UpdateUserRoleInput>(res),
  );
  sendSuccess(res, result);
};

export const listAuditLogs: RequestHandler = async (_req, res) => {
  const query = res.locals.validatedQuery as AuditLogQuery;
  const result = await adminService.listAuditLogs(query);
  sendSuccess(res, result.items, 200, result.pagination);
};
