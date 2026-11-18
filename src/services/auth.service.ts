import type { Role } from "@prisma/client";

import { ApiError } from "../errors.js";
import { prisma } from "../db.js";
import type {
  AcceptInvitationInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  ResetPasswordInput,
} from "../modules/auth/auth.schemas.js";
import { sendPasswordResetEmail } from "./email.service.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  createAccessToken,
  createOpaqueToken,
  expiresInDays,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../utils/security.js";

// Les traitements d'authentification sont regroupés ici car ils appliquent les
// règles métier, mettent à jour PostgreSQL et coordonnent l'envoi des e-mails.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findLoginUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const exactMatch = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (exactMatch) return exactMatch;

  // Les anciens comptes peuvent avoir été créés avant la normalisation en minuscules.
  // Ne choisit pas arbitrairement si plusieurs lignes ne diffèrent que par la casse.
  const legacyMatches = await prisma.user.findMany({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    take: 2,
  });
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

function publicUser(user: { id: string; email: string; name: string; role: Role }) {
  // Ne jamais retourner passwordHash ou d'autres champs internes au client.
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

async function issueSession(user: {
  id: string;
  email: string;
  role: Role;
  tokenVersion: number;
}) {
  // L'access token est court et signé; le refresh token opaque est plus long et
  // peut être révoqué car sa version hachée est enregistrée dans la base.
  const refreshToken = createOpaqueToken();
  const expiresAt = expiresInDays(REFRESH_TOKEN_TTL_DAYS);
  const sessionUser = await prisma.$transaction(async (tx) => {
    // Sérialise l'émission de session avec logout/refresh pour qu'une connexion
    // concurrente ne réintroduise pas un refresh token après sa révocation.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
    `;
    if (lockedUsers.length === 0) throw new ApiError(401, "Compte introuvable.");

    const currentUser = await tx.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, status: true, tokenVersion: true },
    });
    if (!currentUser || currentUser.status !== "ACTIVE") {
      throw new ApiError(403, "Ce compte n'est pas actif.");
    }

    await tx.refreshToken.create({
      data: { userId: currentUser.id, tokenHash: hashToken(refreshToken), expiresAt },
    });
    return currentUser;
  });

  return {
    accessToken: createAccessToken(sessionUser),
    refreshToken,
    tokenType: "Bearer",
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function acceptInvitation(input: AcceptInvitationInput) {
  const { email, temporaryPassword, password } = input;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  // L'invitation est limitée dans le temps et le mot de passe temporaire est
  // vérifié contre son hash, comme un vrai mot de passe.
  if (
    !user ||
    user.status !== "INVITED" ||
    !user.invitationExpiresAt ||
    user.invitationExpiresAt <= new Date() ||
    !(await verifyPassword(temporaryPassword, user.passwordHash))
  ) {
    throw new ApiError(400, "Invitation invalide ou expirée.");
  }

  // updateMany avec les conditions répétées évite qu'un même lien temporaire soit
  // accepté deux fois si deux requêtes arrivent presque simultanément.
  const updated = await prisma.user.updateMany({
    where: {
      id: user.id,
      status: "INVITED",
      passwordHash: user.passwordHash,
      invitationExpiresAt: { gt: new Date() },
    },
    data: {
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      invitationExpiresAt: null,
    },
  });
  if (updated.count !== 1) {
    throw new ApiError(400, "Invitation invalide ou déjà utilisée.");
  }

  return { message: "Compte activé. Vous pouvez maintenant vous connecter." };
}

export async function login(input: LoginInput) {
  const { email, password } = input;
  const user = await findLoginUserByEmail(email);
  // Même message pour e-mail inconnu et mot de passe faux afin de ne pas aider à
  // deviner quelles adresses possèdent un compte.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Adresse e-mail ou mot de passe incorrect.");
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "Ce compte n'est pas actif.");
  }

  return { user: publicUser(user), ...(await issueSession(user)) };
}

export async function refreshSession(input: RefreshInput) {
  const { refreshToken } = input;
  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!stored) throw new ApiError(401, "Refresh token invalide.");

  // Un refresh token déjà consommé est suspect : on révoque les autres sessions
  // de ce compte pour limiter l'impact d'un token copié ou rejoué.
  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new ApiError(401, "Refresh token déjà utilisé ou révoqué.");
  }
  if (stored.expiresAt <= new Date() || stored.user.status !== "ACTIVE") {
    await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new ApiError(401, "Refresh token expiré ou compte inactif.");
  }

  const nextRefreshToken = createOpaqueToken();
  const nextExpiresAt = expiresInDays(REFRESH_TOKEN_TTL_DAYS);
  // Rotation atomique : l'ancien refresh token est marqué révoqué et le nouveau
  // est créé dans la même transaction. Le verrou utilisateur sérialise aussi
  // cette opération avec logout, qui révoque toutes les sessions du compte.
  const rotatedUser = await prisma.$transaction(async (tx) => {
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${stored.userId} FOR UPDATE
    `;
    if (lockedUsers.length === 0) return null;

    const claimed = await tx.refreshToken.updateMany({
      where: {
        id: stored.id,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    const activeUser = await tx.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, role: true, status: true, tokenVersion: true },
    });
    if (!activeUser || activeUser.status !== "ACTIVE") return null;

    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(nextRefreshToken),
        expiresAt: nextExpiresAt,
      },
    });
    return activeUser;
  });

  if (!rotatedUser) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new ApiError(401, "Refresh token déjà utilisé ou révoqué.");
  }

  return {
    accessToken: createAccessToken(rotatedUser),
    refreshToken: nextRefreshToken,
    tokenType: "Bearer",
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: nextExpiresAt,
  };
}

export async function logout(userId: string, input: RefreshInput): Promise<void> {
  const { refreshToken } = input;
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Le verrou empêche un refresh simultané de créer une nouvelle session après
    // que la déconnexion a invalidé le tokenVersion du compte.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;
    if (lockedUsers.length !== 1) throw new ApiError(401, "Compte introuvable.");

    const suppliedToken = await tx.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!suppliedToken || suppliedToken.userId !== userId) {
      throw new ApiError(401, "Refresh token invalide.");
    }

    // tokenVersion est vérifié par requireAuthentication à chaque requête. Comme
    // cette version est propre au compte, logout ferme toutes ses sessions.
    await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });
}

export async function requestPasswordReset(input: ForgotPasswordInput) {
  const { email } = input;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  if (user?.status === "ACTIVE") {
    // Le lien est aléatoire, stocké sous forme de hash et expire rapidement.
    const token = createOpaqueToken();
    const now = new Date();
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        },
      }),
    ]);

    try {
      await sendPasswordResetEmail(user.email, user.name, token);
    } catch (error) {
      console.error("Échec d'envoi du mail de réinitialisation:", error);
    }
  }

  // Réponse identique que l'e-mail existe ou non : cela réduit l'énumération
  // de comptes par une personne qui testerait des adresses.
  return {
    message:
      "Si cette adresse correspond à un compte actif, un e-mail de réinitialisation a été envoyé.",
  };
}

export async function resetPassword(input: ResetPasswordInput) {
  const { email, token, password } = input;
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  const now = new Date();
  // Vérifie la correspondance du compte, l'expiration, l'usage unique et l'état
  // du compte avant d'autoriser le changement de mot de passe.
  if (
    !resetToken ||
    resetToken.user.email !== normalizeEmail(email) ||
    resetToken.usedAt ||
    resetToken.expiresAt <= now ||
    resetToken.user.status !== "ACTIVE"
  ) {
    throw new ApiError(400, "Jeton de réinitialisation invalide ou expiré.");
  }

  const passwordHash = await hashPassword(password);
  // Une transaction garantit que le lien n'est consommé qu'une fois, que le nouveau
  // hash est enregistré et que toutes les anciennes sessions sont révoquées ensemble.
  const reset = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    const activeAccount = await tx.user.updateMany({
      where: { id: resetToken.userId, status: "ACTIVE" },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    if (activeAccount.count !== 1) return false;
    await tx.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: resetToken.userId, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });

  if (!reset) throw new ApiError(400, "Jeton de réinitialisation déjà utilisé.");
  return { message: "Mot de passe modifié. Reconnectez-vous." };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const { currentPassword, newPassword } = input;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(401, "Mot de passe actuel incorrect.");
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new ApiError(400, "Le nouveau mot de passe doit être différent de l'actuel.");
  }

  const newPasswordHash = await hashPassword(newPassword);
  // Après changement, on invalide les JWT via tokenVersion et les refresh tokens
  // en base : les appareils connectés devront se reconnecter.
  const nextTokenVersion = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, status: "ACTIVE" },
      data: {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;

    const updated = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return updated.tokenVersion;
  });
  if (nextTokenVersion === null) {
    throw new ApiError(409, "Le mot de passe a changé. Reconnectez-vous puis réessayez.");
  }

  return {
    message: "Mot de passe modifié.",
    ...(await issueSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: nextTokenVersion,
    })),
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });
  if (!user) throw new ApiError(404, "Utilisateur introuvable.");
  return user;
}
