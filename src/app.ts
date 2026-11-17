import "dotenv/config";

import { randomUUID } from "node:crypto";
import express from "express";

import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { prisma } from "./db.js";
import { ApiError } from "./errors.js";
import { ticketRouter } from "./routes/tickets.routes.js";
import { openApiDocument } from "./openapi.js";
import { createRateLimiter } from "./utils/rate-limit.js";

export const app = express();
app.disable("x-powered-by");

// Un identifiant par requête aide à retrouver une erreur dans les journaux sans
// exposer sa stack trace au client.
app.use((req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

const apiLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 300, message: "Trop de requêtes. Réessayez plus tard." });
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10, message: "Trop de tentatives de connexion. Réessayez plus tard." });
const passwordResetLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 5, message: "Trop de demandes de réinitialisation. Réessayez plus tard." });

app.use(apiLimiter);
app.use(express.json({ limit: "32kb" }));
app.get("/health", (_req, res) => res.json({ data: { status: "ok" } }));
app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
app.use("/auth/login", loginLimiter);
app.use("/auth/forgot-password", passwordResetLimiter);
app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/tickets", ticketRouter);

app.use((_req, _res, next) => next(new ApiError(404, "Route introuvable.")));

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const requestId = String(res.locals.requestId ?? "unknown");
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId,
      });
    }

    // Les erreurs de JSON mal formé sont des erreurs client, pas des erreurs 500.
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({
        error: { code: "INVALID_JSON", message: "Le corps JSON est invalide." },
        requestId,
      });
    }

    if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
      return res.status(413).json({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Le corps de la requête dépasse la limite autorisée." },
        requestId,
      });
    }

    console.error("Erreur API", { requestId, path: req.path, error });
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue." },
      requestId,
    });
  },
);
