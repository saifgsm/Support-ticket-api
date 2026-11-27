import type { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { prisma } from "../db.js";
import { ApiError } from "../errors.js";
import { verifyAccessToken } from "../utils/security.js";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
};

// On ajoute req.user au type Express : après requireAuthentication, les contrôleurs
// peuvent lire l'identité vérifiée au lieu de faire confiance au JSON du client.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Le client transmet normalement l'access token dans l'en-tête HTTP Authorization
  // sous la forme « Bearer <token> ».
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    next(new ApiError(401, "Authentification requise."));
    return;
  }

  // Vérifie la signature et la date d'expiration avant d'utiliser les données du JWT.
  const claims = verifyAccessToken(authorization.slice("Bearer ".length));
  if (!claims) {
    next(new ApiError(401, "Access token invalide ou expiré."));
    return;
  }

  // Le JWT seul ne suffit pas : on relit le compte pour détecter un compte désactivé
  // et invalider les anciens JWT après un changement sensible (tokenVersion).
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, role: true, status: true, tokenVersion: true },
  });
  if (!user || user.status !== "ACTIVE" || user.tokenVersion !== claims.ver) {
    next(new ApiError(401, "Compte inactif ou introuvable."));
    return;
  }

  // On garde uniquement les informations utiles pour les contrôleurs suivants.
  req.user = { id: user.id, email: user.email, role: user.role };
  next();
}

// Fabrique un middleware d'autorisation. Il suppose que requireAuthentication
// est passé avant lui et répond 403 si l'utilisateur connecté n'a pas le bon rôle.
export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, "Authentification requise."));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, "Droits insuffisants."));
      return;
    }
    next();
  };
}
