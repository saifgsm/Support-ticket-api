import { z } from "zod";

// Validation des champs qu'un super-admin peut envoyer pour créer un compte.
// SUPER_ADMIN n'est pas proposé ici afin d'éviter d'en créer un via cette API.
export const createUserSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["ADMIN", "AGENT", "USER"]),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["ADMIN", "AGENT", "USER"]),
});

export const adminUserIdParamsSchema = z.object({
  id: z.string().min(1).max(100),
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Ces types TypeScript sont déduits des schémas : la validation et les types
// utilisés par les services restent ainsi cohérents.
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
