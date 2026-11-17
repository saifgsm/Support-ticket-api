import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { ApiError } from "../../errors.js";

// Middleware réutilisable : chaque route lui donne son schéma Zod pour vérifier
// req.body avant d'appeler le contrôleur.
function validator(schema: z.ZodType, source: "body" | "query" | "params") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new ApiError(400, "Données invalides.", {
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      }));
      return;
    }

    // Le contrôleur ne lit que les valeurs validées par le schéma correspondant.
    res.locals[`validated${source[0]!.toUpperCase()}${source.slice(1)}`] = result.data;
    next();
  };
}

export const validateBody = (schema: z.ZodType) => validator(schema, "body");
export const validateQuery = (schema: z.ZodType) => validator(schema, "query");
export const validateParams = (schema: z.ZodType) => validator(schema, "params");
