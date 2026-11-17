import { Prisma } from "@prisma/client";

import { ApiError } from "../errors.js";
import { prisma } from "../db.js";
import type {
  AuditLogQuery,
  CreateUserInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
} from "../modules/admin/admin.schemas.js";
import { sendInvitationEmail } from "./email.service.js";
import { createOpaqueToken, expiresInDays, hashPassword } from "../utils/security.js";

// La normalisation rend les recherches d'adresse cohérentes malgré les majuscules
// ou espaces accidentels envoyés par l'utilisateur.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listUsers() {
  // select limite les données renvoyées : le hash du mot de passe ne sort jamais
  // de la base dans la réponse de cette API.
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createUser(input: CreateUserInput, actorId: string) {
  const { email, name, role } = input;
  const normalizedEmail = normalizeEmail(email);
  // Vérification lisible avant l'insertion; la contrainte unique en base protège
  // aussi contre deux créations concurrentes de la même adresse.
  if (
    await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    })
  ) {
    throw new ApiError(409, "Un compte utilise déjà cette adresse e-mail.");
  }

  // L'invitation n'envoie pas un mot de passe choisi par l'admin : on en génère un
  // aléatoire, on ne garde que son hash et on lui donne une durée limitée.
  const temporaryPassword = createOpaqueToken();
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: name.trim(),
          role,
          status: "INVITED",
          passwordHash: await hashPassword(temporaryPassword),
          invitationExpiresAt: expiresInDays(7),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "USER_CREATED",
          targetUserId: created.id,
          details: { assignedRole: role, email: normalizedEmail },
        },
      });
      return created;
    });
  } catch (error) {
    // P2002 est l'erreur Prisma d'une contrainte unique, utile si une autre requête
    // a créé cette adresse entre notre vérification et l'insertion.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "Un compte utilise déjà cette adresse e-mail.");
    }
    throw error;
  }

  // La création du compte et l'envoi externe du mail sont deux opérations séparées :
  // si Resend est indisponible, le compte reste créé et l'admin peut renvoyer l'invitation.
  let emailSent = true;
  try {
    await sendInvitationEmail(user.email, user.name, temporaryPassword);
  } catch (error) {
    emailSent = false;
    console.error("Échec d'envoi de l'invitation:", error);
  }

  return {
    user,
    invitationEmailSent: emailSent,
    message: emailSent
      ? "Compte créé. L'utilisateur recevra son mot de passe temporaire par e-mail."
      : "Compte créé, mais l'e-mail n'a pas pu être envoyé. Utilisez POST /admin/users/:id/resend-invitation après avoir vérifié Resend.",
  };
}

export async function resendInvitation(userId: string, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Utilisateur introuvable.");
  if (user.status !== "INVITED") {
    throw new ApiError(409, "Ce compte n'attend pas d'acceptation d'invitation.");
  }

  // Un nouvel envoi révoque de fait l'ancien secret en remplaçant son hash et son expiration.
  const temporaryPassword = createOpaqueToken();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        invitationExpiresAt: expiresInDays(7),
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        targetUserId: user.id,
        action: "INVITATION_RESENT",
      },
    }),
  ]);

  try {
    await sendInvitationEmail(user.email, user.name, temporaryPassword);
  } catch (error) {
    console.error("Échec de renvoi de l'invitation:", error);
    throw new ApiError(502, "L'e-mail n'a pas pu être envoyé. Vérifiez la configuration Resend.");
  }

  return { message: "Nouvelle invitation envoyée. L'ancien mot de passe temporaire est révoqué." };
}

export async function updateUserStatus(
  userId: string,
  actorId: string,
  input: UpdateUserStatusInput,
) {
  const { status } = input;

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ApiError(404, "Utilisateur introuvable.");
  // Empêche le super-admin courant de couper son propre accès par erreur.
  if (existing.id === actorId && status === "DISABLED") {
    throw new ApiError(409, "Vous ne pouvez pas désactiver votre propre compte.");
  }
  if (existing.status === "INVITED") {
    throw new ApiError(409, "L'utilisateur doit d'abord accepter son invitation.");
  }
  if (existing.status === status) {
    throw new ApiError(409, "Le compte a déjà cet état.");
  }

  // Changement d'état, révocation des sessions et audit sont validés ensemble.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status === "DISABLED" ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });

    if (status === "DISABLED") {
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        targetUserId: user.id,
        action: status === "DISABLED" ? "USER_DISABLED" : "USER_REACTIVATED",
        details: { previousStatus: existing.status, nextStatus: status },
      },
    });
    return user;
  });
}

export async function updateUserRole(
  userId: string,
  actorId: string,
  input: UpdateUserRoleInput,
) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ApiError(404, "Utilisateur introuvable.");
  if (existing.id === actorId) {
    throw new ApiError(409, "Vous ne pouvez pas modifier votre propre rôle.");
  }
  if (existing.role === input.role) {
    throw new ApiError(409, "L'utilisateur a déjà ce rôle.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: existing.id, role: existing.role },
      data: { role: input.role, tokenVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ApiError(409, "Le rôle a changé. Rechargez puis réessayez.");

    await tx.refreshToken.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        targetUserId: existing.id,
        action: "USER_ROLE_CHANGED",
        details: { previousRole: existing.role, nextRole: input.role },
      },
    });
    return tx.user.findUniqueOrThrow({
      where: { id: existing.id },
      select: { id: true, email: true, name: true, role: true, status: true, updatedAt: true },
    });
  });
}

export async function listAuditLogs(query: AuditLogQuery) {
  const skip = (query.page - 1) * query.limit;
  const [items, totalItems] = await prisma.$transaction([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: query.limit,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        actor: { select: { id: true, email: true, name: true } },
        targetUser: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.auditLog.count(),
  ]);
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}
