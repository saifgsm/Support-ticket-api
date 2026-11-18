import { z } from "zod";

// Règles réutilisées par plusieurs opérations d'authentification : une adresse
// doit ressembler à un e-mail, et un nouveau mot de passe doit être assez long.
const email = z.string().trim().pipe(z.email().max(254));
const password = z.string().min(12, "Le mot de passe doit contenir au moins 12 caractères.").max(128);

// Chaque schéma décrit la forme attendue du JSON pour une route précise.
export const acceptInvitationSchema = z.object({
  email,
  temporaryPassword: z.string().min(1).max(256),
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export const logoutSchema = refreshSchema;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  email,
  token: z.string().min(1).max(512),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
