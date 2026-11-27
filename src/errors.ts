export class ApiError extends Error {
  // Cette erreur transporte un statut HTTP (par ex. 404) jusqu'au gestionnaire
  // central de server.ts, sans mélanger les réponses HTTP et la logique métier.
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly code = statusCodeCode(statusCode),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function statusCodeCode(statusCode: number): string {
  const knownCodes: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "TOO_MANY_REQUESTS",
    502: "UPSTREAM_ERROR",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
  };
  return knownCodes[statusCode] ?? "API_ERROR";
}
