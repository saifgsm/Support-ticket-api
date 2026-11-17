import { app } from "./app.js";
import { prisma } from "./db.js";

// server.ts ne fait qu'ouvrir le port. app.ts peut ainsi être importé dans les
// tests d'intégration sans démarrer un serveur caché.
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`Support Ticket API: http://localhost:${port}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
