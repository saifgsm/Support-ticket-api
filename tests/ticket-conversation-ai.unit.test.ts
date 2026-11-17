import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../src/errors.js";
import { TICKET_CONVERSATION_SYSTEM_PROMPT } from "../src/modules/tickets/ticket-conversation.prompt.js";
import {
  buildConversationInput,
  createTicketConversationAiService,
  type TicketConversationContext,
} from "../src/services/ticket-conversation-ai.service.js";

const context: TicketConversationContext = {
  ticket: {
    title: "Impossible de se connecter",
    description: "Un message d'erreur apparaît au login.",
    category: "AUTHENTICATION",
    status: "open",
  },
  comments: [
    { type: "USER", content: "Le message dit que le service est indisponible." },
    { type: "AI", content: "Pouvez-vous réessayer après quelques minutes ?" },
    { type: "USER", content: "J'ai déjà attendu et redémarré." },
  ],
};

const ticketId = "550e8400-e29b-41d4-a716-446655440000";

test("l'historique transforme les commentaires USER et AI en rôles user et assistant", () => {
  const input = buildConversationInput(context);

  assert.deepEqual(input.map((message) => message.role), ["system", "user", "user", "assistant", "user"]);
  assert.match(input[1]?.content ?? "", /Impossible de se connecter/);
  assert.match(input[2]?.content ?? "", /service est indisponible/);
  assert.match(input[3]?.content ?? "", /réessayer après quelques minutes/);
  assert.match(input[4]?.content ?? "", /redémarré/);
  assert.equal(input.some((message) => message.content.includes("user@example.com")), false);
});

test("le prompt de conversation prévoit l'humour hors sujet sans se moquer du client", () => {
  assert.match(TICKET_CONVERSATION_SYSTEM_PROMPT, /touche d'humour bienveillante/);
  assert.match(TICKET_CONVERSATION_SYSTEM_PROMPT, /Ne te moque jamais de l'utilisateur/);
  assert.match(TICKET_CONVERSATION_SYSTEM_PROMPT, /situation personnelle grave/);
});

test("le service renvoie seulement une réponse non vide validée et nettoyée", async () => {
  let capturedRoles: string[] = [];
  const service = createTicketConversationAiService({
    loadContext: async () => context,
    generateResponse: async (input) => {
      capturedRoles = input.map((message) => message.role);
      return { content: "  Voici une piste à vérifier.  " };
    },
  });

  assert.equal(await service.generateReply(ticketId), "Voici une piste à vérifier.");
  assert.deepEqual(capturedRoles, ["system", "user", "user", "assistant", "user"]);
});

test("une réponse vide ou avec le mauvais format est refusée par Zod", async () => {
  for (const output of [{ content: "   " }, { text: "Réponse sans le champ content." }]) {
    const service = createTicketConversationAiService({
      loadContext: async () => context,
      generateResponse: async () => output,
    });
    await assert.rejects(
      service.generateReply(ticketId),
      (error: unknown) => error instanceof ApiError && error.statusCode === 502,
    );
  }
});

test("les pannes IA sont converties en erreurs génériques et les délais en 504", async () => {
  const unavailable = createTicketConversationAiService({
    loadContext: async () => context,
    generateResponse: async () => { throw new Error("secret fournisseur interne"); },
  });
  await assert.rejects(
    unavailable.generateReply(ticketId),
    (error: unknown) => error instanceof ApiError
      && error.statusCode === 502
      && !error.message.includes("secret fournisseur interne"),
  );

  const timeout = new Error("détail réseau privé");
  timeout.name = "APIConnectionTimeoutError";
  const timedOut = createTicketConversationAiService({
    loadContext: async () => context,
    generateResponse: async () => { throw timeout; },
  });
  await assert.rejects(
    timedOut.generateReply(ticketId),
    (error: unknown) => error instanceof ApiError && error.statusCode === 504,
  );
});
