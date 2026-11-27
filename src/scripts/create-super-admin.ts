// Charge .env avant de lire les identifiants du premier super-admin.
import "dotenv/config";

import { prisma } from "../db.js";
import { hashPassword, passwordIsValid } from "../utils/security.js";

// Création initiale hors API : comme il n'y a pas d'inscription publique,
// cette commande permet de créer le premier compte qui pourra inviter les autres.
async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("SUPER_ADMIN_EMAIL doit contenir une adresse e-mail valide.");
  }
  if (!passwordIsValid(password)) {
    throw new Error("SUPER_ADMIN_PASSWORD doit contenir entre 12 et 128 caractères.");
  }

  // Le script refuse d'écraser un compte existant pour éviter une réinitialisation
  // involontaire de son rôle ou de son mot de passe.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Un compte existe déjà avec cette adresse. La commande ne modifie aucun compte existant.");
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    select: { id: true, email: true, role: true, status: true },
  });
  console.log("Super admin créé :", user);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
