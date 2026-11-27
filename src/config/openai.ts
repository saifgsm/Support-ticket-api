import OpenAI from "openai";

import { ApiError } from "../errors.js";

const clients = new Map<number, OpenAI>();

// Création différée : les autres routes et les tests sans OpenAI peuvent démarrer
// sans initialiser le SDK ni avoir besoin de la clé API.
export function getOpenAIClient(options: { maxRetries?: number } = {}): OpenAI {
  const maxRetries = options.maxRetries ?? 1;
  const cachedClient = clients.get(maxRetries);
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(503, "Le service IA n'est pas configuré.");
  }

  const client = new OpenAI({
    apiKey,
    timeout: 30_000,
    maxRetries,
  });
  clients.set(maxRetries, client);
  return client;
}

// Le modèle se règle côté serveur sans modifier le code source.
export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-6-astra";
}
