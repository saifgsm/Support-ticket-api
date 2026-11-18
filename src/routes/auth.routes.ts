import { Router } from "express";

import * as authController from "../controllers/auth.controller.js";
import { requireAuthentication } from "../middlewares/auth.middleware.js";
import { validateBody } from "../modules/validation/validate-body.js";
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
} from "../modules/auth/auth.schemas.js";

export const authRouter = Router();

// Connexion, invitation et réinitialisation sont publiques : l'utilisateur n'a
// pas encore forcément de session. Les données sont quand même validées par Zod.
authRouter.post(
  "/accept-invitation",
  validateBody(acceptInvitationSchema),
  authController.acceptInvitation,
);
authRouter.post("/login", validateBody(loginSchema), authController.login);
authRouter.post("/refresh", validateBody(refreshSchema), authController.refresh);
authRouter.post(
  "/logout",
  requireAuthentication,
  validateBody(logoutSchema),
  authController.logout,
);
authRouter.post(
  "/forgot-password",
  validateBody(forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  authController.resetPassword,
);
authRouter.patch(
  "/password",
  // Changer un mot de passe exige une session : le compte concerné vient du token,
  // pas d'un identifiant librement fourni dans le corps de la requête.
  requireAuthentication,
  validateBody(changePasswordSchema),
  authController.changePassword,
);
// Renvoie les informations du compte associé au token présenté.
authRouter.get("/me", requireAuthentication, authController.getMe);
