import { Router } from "express";

import { requireAuthentication, requireRoles } from "../middlewares/auth.middleware.js";
import * as adminController from "../controllers/admin.controller.js";
import { validateBody, validateParams, validateQuery } from "../modules/validation/validate-body.js";
import {
  adminUserIdParamsSchema,
  auditLogQuerySchema,
  createUserSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
} from "../modules/admin/admin.schemas.js";

export const adminRouter = Router();

// Toutes les URL /admin exigent d'abord un utilisateur connecté, puis le rôle
// SUPER_ADMIN. On applique ces règles une seule fois à tout le routeur.
adminRouter.use(requireAuthentication, requireRoles("SUPER_ADMIN"));
// Chaque route associe une méthode + URL à un contrôleur; Zod valide les corps
// JSON avant que le contrôleur ne commence le traitement.
adminRouter.get("/users", adminController.listUsers);
adminRouter.post("/users", validateBody(createUserSchema), adminController.createUser);
adminRouter.get("/audit-logs", validateQuery(auditLogQuerySchema), adminController.listAuditLogs);
adminRouter.post(
  "/users/:id/resend-invitation",
  validateParams(adminUserIdParamsSchema),
  adminController.resendInvitation,
);
adminRouter.patch(
  "/users/:id/status",
  validateParams(adminUserIdParamsSchema),
  validateBody(updateUserStatusSchema),
  adminController.updateUserStatus,
);
adminRouter.patch(
  "/users/:id/role",
  validateParams(adminUserIdParamsSchema),
  validateBody(updateUserRoleSchema),
  adminController.updateUserRole,
);
