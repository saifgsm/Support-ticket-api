import type { Request, RequestHandler } from "express";

import { ApiError } from "../errors.js";

type Bucket = { count: number; resetAt: number };

/** Limiteur local par adresse IP, prévu pour une instance du serveur. */
export function createRateLimiter(options: {
  windowMs: number;
  limit: number;
  message: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const key = requestKey(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader("RateLimit-Limit", options.limit);
    res.setHeader("RateLimit-Remaining", Math.max(0, options.limit - bucket.count));
    res.setHeader("RateLimit-Reset", Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > options.limit) {
      next(new ApiError(429, options.message));
      return;
    }

    // Nettoyage opportuniste afin que les compteurs expirés ne restent pas en mémoire.
    if (buckets.size > 10_000) {
      for (const [address, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(address);
      }
      // Garde un plafond mémoire si de très nombreuses IP différentes apparaissent.
      while (buckets.size > 10_000) {
        const oldestAddress = buckets.keys().next().value as string | undefined;
        if (!oldestAddress) break;
        buckets.delete(oldestAddress);
      }
    }
    next();
  };
}

function requestKey(req: Request): string {
  // X-Forwarded-For n'est pris en compte que si trust proxy est explicitement configuré.
  return req.ip || req.socket.remoteAddress || "unknown";
}
