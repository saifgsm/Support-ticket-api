import { PrismaClient } from "@prisma/client";

// Un client Prisma partagé évite de recréer une connexion à chaque requête.
export const prisma = new PrismaClient();
