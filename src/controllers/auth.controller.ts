import type { RequestHandler, Response } from "express";

import { ApiError } from "../errors.js";
import type {
  AcceptInvitationInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  ResetPasswordInput,
} from "../modules/auth/auth.schemas.js";
import * as authService from "../services/auth.service.js";
import { sendSuccess } from "../utils/http-response.js";

// Le contrôleur reste volontairement mince : il transforme une requête HTTP en
// appel de service, puis renvoie le résultat au client (Postman ou application).
function getValidatedBody<T>(response: Response): T {
  return response.locals.validatedBody as T;
}

function getAuthenticatedUserId(request: Parameters<RequestHandler>[0]): string {
  if (!request.user) throw new ApiError(401, "Authentification requise.");
  return request.user.id;
}

export const acceptInvitation: RequestHandler = async (req, res) => {
  const result = await authService.acceptInvitation(
    getValidatedBody<AcceptInvitationInput>(res),
  );
  sendSuccess(res, result);
};

export const login: RequestHandler = async (req, res) => {
  const result = await authService.login(getValidatedBody<LoginInput>(res));
  sendSuccess(res, result);
};

export const refresh: RequestHandler = async (req, res) => {
  const result = await authService.refreshSession(getValidatedBody<RefreshInput>(res));
  sendSuccess(res, result);
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(
    getAuthenticatedUserId(req),
    getValidatedBody<RefreshInput>(res),
  );
  // tokenVersion invalide les access tokens de ce compte; 204 ne renvoie aucun corps.
  res.status(204).send();
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const result = await authService.requestPasswordReset(
    getValidatedBody<ForgotPasswordInput>(res),
  );
  sendSuccess(res, result);
};

export const resetPassword: RequestHandler = async (req, res) => {
  const result = await authService.resetPassword(
    getValidatedBody<ResetPasswordInput>(res),
  );
  sendSuccess(res, result);
};

export const changePassword: RequestHandler = async (req, res) => {
  const result = await authService.changePassword(
    getAuthenticatedUserId(req),
    getValidatedBody<ChangePasswordInput>(res),
  );
  sendSuccess(res, result);
};

export const getMe: RequestHandler = async (req, res) => {
  const result = await authService.getCurrentUser(getAuthenticatedUserId(req));
  sendSuccess(res, result);
};
