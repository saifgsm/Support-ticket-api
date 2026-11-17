import assert from "node:assert/strict";
import { test } from "node:test";
import { zodTextFormat } from "openai/helpers/zod";

import { ApiError } from "../src/errors.js";
import { ticketAiResponseSchema, type TicketAiResponse } from "../src/modules/tickets/ticket-ai.schemas.js";
import {
  createTicketAiService,
  type SaveDraftInput,
  type TicketAiInput,
} from "../src/services/ticket-ai.service.js";

const ticketId = "550e8400-e29b-41d4-a716-446655440000";

const ticket: TicketAiInput = {
  id: ticketId,
  title: "Impossible de me connecter",
  description: "Après la saisie de mon adresse, un message d'erreur apparaît.",
  category: "AUTHENTICATION",
  status: "open",
};

const validResponse: TicketAiResponse = {
  is_it_related: true,
  category: "AUTHENTICATION",
  summary: "Le client rencontre une erreur pendant la connexion.",
  possible_cause: null,
  resolution_steps: ["Demander le texte exact du message d'erreur."],
  customer_response: "Bonjour, pouvez-vous nous transmettre le texte exact du message affiché ?",
  needs_more_information: true,
  needs_human: false,
};

function makeService(options: {
  output?: unknown;
  generateError?: Error;
  ticketResult?: TicketAiInput;
} = {}) {
  let saved: SaveDraftInput | undefined;
  let generationCalls = 0;

  const service = createTicketAiService({
    model: "test-model",
    getTicket: async () => {
      if (!options.ticketResult) throw new ApiError(404, "Ticket introuvable.");
      return options.ticketResult;
    },
    generateResponse: async () => {
      generationCalls += 1;
      if (options.generateError) throw options.generateError;
      return options.output ?? validResponse;
    },
    saveDraft: async (input) => {
      saved = input;
      return { id: "draft-test-1", ...input, createdAt: new Date("2026-01-01T00:00:00Z") };
    },
  });

  return {
    service,
    getSaved: () => saved,
    getGenerationCalls: () => generationCalls,
  };
}

test("les problèmes de connexion et d'affichage produisent une sortie au format prévu", () => {
  const connection = ticketAiResponseSchema.parse(validResponse);
  assert.equal(connection.category, "AUTHENTICATION");
  assert.equal(connection.is_it_related, true);

  const display = ticketAiResponseSchema.parse({
    ...validResponse,
    category: "DISPLAY",
    summary: "Un élément de l'interface ne s'affiche pas.",
  });
  assert.equal(display.category, "DISPLAY");
});

test("le helper OpenAI accepte le schéma Zod 4 comme sortie structurée", () => {
  const format = zodTextFormat(ticketAiResponseSchema, "ticket_ai_response");
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
});

test("un ticket incomplet peut demander des précisions sans inventer de cause", () => {
  const response = ticketAiResponseSchema.parse({
    ...validResponse,
    possible_cause: null,
    resolution_steps: [],
    needs_more_information: true,
  });
  assert.equal(response.possible_cause, null);
  assert.deepEqual(response.resolution_steps, []);
  assert.equal(response.needs_more_information, true);
});

test("un ticket hors IT peut être représenté par un refus structuré", () => {
  const response = ticketAiResponseSchema.parse({
    ...validResponse,
    is_it_related: false,
    category: "OTHER",
    summary: "La demande ne concerne pas le support informatique.",
    possible_cause: null,
    resolution_steps: [],
    customer_response: "Ce service traite uniquement les problèmes informatiques.",
    needs_more_information: false,
  });
  assert.equal(response.is_it_related, false);
  assert.equal(response.category, "OTHER");
});

test("le service valide et enregistre le brouillon sans changer la catégorie du ticket", async () => {
  const harness = makeService({
    ticketResult: ticket,
    output: { ...validResponse, category: "DISPLAY" },
  });

  const result = await harness.service.createDraft(ticketId, "agent-1", "AGENT");

  assert.equal(harness.getGenerationCalls(), 1);
  assert.equal(harness.getSaved()?.ticketId, ticketId);
  assert.equal(harness.getSaved()?.generatedById, "agent-1");
  assert.equal(harness.getSaved()?.model, "test-model");
  assert.equal(harness.getSaved()?.response.category, "AUTHENTICATION");
  assert.deepEqual(result, {
    id: "draft-test-1",
    ...harness.getSaved(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
});

test("une sortie invalide ou une panne OpenAI ne crée pas de brouillon", async () => {
  const invalid = makeService({ ticketResult: ticket, output: { customer_response: "incomplet" } });
  await assert.rejects(
    invalid.service.createDraft(ticketId, "agent-1", "AGENT"),
    (error: unknown) => error instanceof ApiError && error.statusCode === 502,
  );
  assert.equal(invalid.getSaved(), undefined);

  const failed = makeService({ ticketResult: ticket, generateError: new Error("private provider detail") });
  await assert.rejects(
    failed.service.createDraft(ticketId, "agent-1", "AGENT"),
    (error: unknown) => error instanceof ApiError
      && error.statusCode === 502
      && !error.message.includes("private provider detail"),
  );
  assert.equal(failed.getSaved(), undefined);
});

test("le délai OpenAI expiré devient une erreur 504 générique", async () => {
  const timeout = new Error("private timeout detail");
  timeout.name = "APIConnectionTimeoutError";
  const harness = makeService({ ticketResult: ticket, generateError: timeout });

  await assert.rejects(
    harness.service.createDraft(ticketId, "agent-1", "AGENT"),
    (error: unknown) => error instanceof ApiError
      && error.statusCode === 504
      && !error.message.includes("private timeout detail"),
  );
  assert.equal(harness.getSaved(), undefined);
});

test("un ticket absent est refusé avant tout appel au modèle", async () => {
  const harness = makeService();
  await assert.rejects(
    harness.service.createDraft("550e8400-e29b-41d4-a716-446655440001", "agent-1", "AGENT"),
    (error: unknown) => error instanceof ApiError && error.statusCode === 404,
  );
  assert.equal(harness.getGenerationCalls(), 0);
  assert.equal(harness.getSaved(), undefined);
});
