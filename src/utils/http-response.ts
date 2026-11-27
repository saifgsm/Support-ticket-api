import type { Response } from "express";

/** Format commun des réponses réussies de l'API. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): void {
  res.status(statusCode).json({ data, ...(meta ? { meta } : {}) });
}
