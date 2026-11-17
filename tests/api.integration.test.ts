import assert from "node:assert/strict";
import express from "express";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { ApiError } from "../src/errors.js";

await import("dotenv/config");

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Définis TEST_DATABASE_URL vers une base réservée aux tests avant npm test.");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "unit-and-integration-test-secret-at-least-32-chars";

const { app } = await import("../src/app.js");
const { prisma } = await import("../src/db.js");
const { createAccessToken, hashPassword } = await import("../src/utils/security.js");
const { createTicketRouter } = await import("../src/routes/tickets.routes.js");
const { createGenerateAiResponseHandler } = await import("../src/controllers/tickets.controller.js");
const { createTicketCommentsController } = await import("../src/controllers/ticket-comments.controller.js");
const { createTicketAiService } = await import("../src/services/ticket-ai.service.js");
const { createTicketCommentsService } = await import("../src/services/ticket-comments.service.js");
const ticketService = await import("../src/services/tickets.service.js");

// Cette application de test injecte une réponse factice, mais utilise la vraie
// base PostgreSQL de test pour vérifier l'enregistrement du brouillon.
const testAiService = createTicketAiService({
  model: "mock-model",
  getTicket: (id, userId, role) => ticketService.getTicket(id, userId, role),
  generateResponse: async (ticket) => ({
    is_it_related: true,
    category: ticket.category,
    summary: "Le client ne parvient pas à se connecter.",
    possible_cause: null,
    resolution_steps: ["Demander le message d'erreur exact."],
    customer_response: "Bonjour, pouvez-vous préciser le message affiché ?",
    needs_more_information: true,
    needs_human: false,
  }),
  saveDraft: (input) => prisma.ticketAiDraft.create({
    data: {
      ticketId: input.ticketId,
      generatedById: input.generatedById,
      model: input.model,
      response: input.response as Prisma.InputJsonValue,
    },
  }),
});
const conversationHarness: {
  generationCalls: number;
  failNext: boolean;
  onGenerationStart: (() => void) | undefined;
  waitForGeneration: Promise<void> | undefined;
} = {
  generationCalls: 0,
  failNext: false,
  onGenerationStart: undefined,
  waitForGeneration: undefined,
};
const testCommentsService = createTicketCommentsService({
  generateReply: async () => {
    conversationHarness.generationCalls += 1;
    conversationHarness.onGenerationStart?.();
    if (conversationHarness.waitForGeneration) await conversationHarness.waitForGeneration;
    if (conversationHarness.failNext) {
      conversationHarness.failNext = false;
      throw new ApiError(502, "Le service IA est temporairement indisponible.");
    }
    return `Réponse fictive ${conversationHarness.generationCalls}`;
  },
});
const testCommentsController = createTicketCommentsController(testCommentsService);
const testAiApp = express();
testAiApp.use(express.json({ limit: "32kb" }));
testAiApp.use("/tickets", createTicketRouter(
  createGenerateAiResponseHandler(testAiService),
  testCommentsController,
));
testAiApp.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
      requestId: "integration-test",
    });
  }
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erreur de test." } });
});

const testPrefix = `test-${randomUUID()}`;
const commonPassword = "test-password-123456";
const createdTicketIds: string[] = [];
let baseUrl = "";
let server: ReturnType<typeof app.listen>;
let aiBaseUrl = "";
let aiServer: ReturnType<typeof testAiApp.listen>;

before(async () => {
  await prisma.$connect();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  aiServer = testAiApp.listen(0);
  await new Promise<void>((resolve) => aiServer.once("listening", resolve));
  const aiAddress = aiServer.address();
  assert.ok(aiAddress && typeof aiAddress !== "string");
  aiBaseUrl = `http://127.0.0.1:${aiAddress.port}`;
});

after(async () => {
  if (createdTicketIds.length > 0) {
    await prisma.ticketAiDraft.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: testPrefix } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => aiServer.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
});

async function createUser(role: "SUPER_ADMIN" | "ADMIN" | "AGENT" | "USER") {
  const user = await prisma.user.create({
    data: {
      email: `${testPrefix}-${role.toLowerCase()}-${randomUUID()}@example.test`,
      name: `Test ${role}`,
      passwordHash: await hashPassword(commonPassword),
      role,
      status: "ACTIVE",
    },
  });
  return {
    user,
    token: createAccessToken({ id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }),
  };
}

async function callApi(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function callAiApi(
  path: string,
  token?: string,
  options: { method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${aiBaseUrl}${path}`, {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createCustomerTicket(token: string) {
  const response = await callApi("/tickets", {
    method: "POST",
    token,
    body: { title: "Test conversation", description: "Problème informatique de test.", category: "BUG" },
  });
  const body = await response.json() as { data: { id: string; status: string } };
  assert.equal(response.status, 201);
  createdTicketIds.push(body.data.id);
  return body.data;
}

test("les réponses d'erreur ont un format commun et un identifiant de requête", async () => {
  const response = await callApi("/not-a-route");
  const body = await response.json() as { error: { code: string; message: string }; requestId: string };
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
});

test("la spécification OpenAPI est servie par l'API", async () => {
  const response = await callApi("/openapi.json");
  const spec = await response.json() as { openapi: string; paths: Record<string, unknown> };
  assert.equal(response.status, 200);
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/tickets"]);
});

test("Zod refuse les données invalides avant la création du ticket", async () => {
  const { token } = await createUser("USER");
  const response = await callApi("/tickets", { method: "POST", token, body: { title: "", description: "" } });
  const body = await response.json() as { error: { code: string; details: { issues: unknown[] } } };
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "BAD_REQUEST");
  assert.ok(body.error.details.issues.length > 0);
});

test("la création refuse une catégorie invalide ou absente", async () => {
  const { token } = await createUser("USER");
  const invalidCategory = await callApi("/tickets", {
    method: "POST", token,
    body: { title: "Problème", description: "Description", category: "UNKNOWN" },
  });
  const missingCategory = await callApi("/tickets", {
    method: "POST", token,
    body: { title: "Problème", description: "Description" },
  });

  assert.equal(invalidCategory.status, 400);
  assert.equal(missingCategory.status, 400);
});

test("l'authentification accepte un bon mot de passe et refuse un mauvais token", async () => {
  const { user } = await createUser("USER");
  const login = await callApi("/auth/login", { method: "POST", body: { email: user.email, password: commonPassword } });
  assert.equal(login.status, 200);
  const loginBody = await login.json() as { data: { accessToken: string; refreshToken: string } };
  assert.ok(loginBody.data.accessToken);
  assert.ok(loginBody.data.refreshToken);

  const protectedResponse = await callApi("/auth/me", { token: "bad-token" });
  assert.equal(protectedResponse.status, 401);
});

test("les rôles limitent l'accès, les utilisateurs ne voient que leurs tickets et la liste est paginée", async () => {
  const owner = await createUser("USER");
  const other = await createUser("USER");
  const agent = await createUser("AGENT");

  const adminRoute = await callApi("/admin/users", { token: owner.token });
  assert.equal(adminRoute.status, 403);

  const first = await callApi("/tickets", { method: "POST", token: owner.token, body: { title: "Alpha A", description: "premier", category: "AUTHENTICATION" } });
  const firstBody = await first.json() as { data: { id: string; category: string } };
  createdTicketIds.push(firstBody.data.id);
  assert.equal(first.status, 201);
  assert.equal(firstBody.data.category, "AUTHENTICATION");
  const second = await callApi("/tickets", { method: "POST", token: owner.token, body: { title: "Alpha B", description: "deuxième", category: "DISPLAY" } });
  const secondBody = await second.json() as { data: { id: string } };
  createdTicketIds.push(secondBody.data.id);
  assert.equal(second.status, 201);

  const listing = await callApi("/tickets?page=1&limit=1&sortBy=title&order=asc&q=Alpha", { token: owner.token });
  const listingBody = await listing.json() as { data: Array<{ title: string }>; meta: { totalItems: number; totalPages: number } };
  assert.equal(listing.status, 200);
  assert.equal(listingBody.data.length, 1);
  assert.equal(listingBody.meta.totalItems, 2);
  assert.equal(listingBody.meta.totalPages, 2);

  const categoryOnly = await callApi("/tickets?category=AUTHENTICATION", { token: owner.token });
  const categoryBody = await categoryOnly.json() as { data: Array<{ category: string }> };
  assert.equal(categoryOnly.status, 200);
  assert.equal(categoryBody.data.length, 1);
  assert.equal(categoryBody.data[0]?.category, "AUTHENTICATION");

  const categoryAndStatus = await callApi(
    "/tickets?category=AUTHENTICATION&status=open",
    { token: owner.token },
  );
  const filteredBody = await categoryAndStatus.json() as { data: Array<{ category: string; status: string }> };
  assert.equal(categoryAndStatus.status, 200);
  assert.equal(filteredBody.data.length, 1);
  assert.equal(filteredBody.data[0]?.category, "AUTHENTICATION");
  assert.equal(filteredBody.data[0]?.status, "open");

  const hidden = await callApi(`/tickets/${firstBody.data.id}`, { token: other.token });
  assert.equal(hidden.status, 404);

  const forbidden = await callApi(`/tickets/${firstBody.data.id}/status`, { method: "PATCH", token: owner.token, body: { status: "closed" } });
  assert.equal(forbidden.status, 403);
  const allowed = await callApi(`/tickets/${firstBody.data.id}/status`, { method: "PATCH", token: agent.token, body: { status: "closed" } });
  assert.equal(allowed.status, 200);
});

test("un changement de rôle est audité et invalide les anciennes sessions", async () => {
  const admin = await createUser("SUPER_ADMIN");
  const target = await createUser("USER");
  const changed = await callApi(`/admin/users/${target.user.id}/role`, {
    method: "PATCH", token: admin.token, body: { role: "AGENT" },
  });
  assert.equal(changed.status, 200);

  const staleSession = await callApi("/auth/me", { token: target.token });
  assert.equal(staleSession.status, 401);

  const logs = await callApi("/admin/audit-logs?page=1&limit=20", { token: admin.token });
  const logBody = await logs.json() as { data: Array<{ action: string; targetUser: { id: string } | null }> };
  assert.ok(logBody.data.some((log) => log.action === "USER_ROLE_CHANGED" && log.targetUser?.id === target.user.id));
});

test("la désactivation est auditée et bloque immédiatement l'ancien access token", async () => {
  const admin = await createUser("SUPER_ADMIN");
  const target = await createUser("AGENT");
  const disabled = await callApi(`/admin/users/${target.user.id}/status`, {
    method: "PATCH", token: admin.token, body: { status: "DISABLED" },
  });
  assert.equal(disabled.status, 200);

  const blocked = await callApi("/auth/me", { token: target.token });
  assert.equal(blocked.status, 401);

  const logs = await callApi("/admin/audit-logs?page=1&limit=20", { token: admin.token });
  const logBody = await logs.json() as { data: Array<{ action: string; targetUser: { id: string } | null }> };
  assert.ok(logBody.data.some((log) => log.action === "USER_DISABLED" && log.targetUser?.id === target.user.id));
});

test("la génération IA exige un token et autorise le USER propriétaire du ticket", async () => {
  const anonymous = await callApi("/tickets/00000000-0000-4000-8000-000000000001/ai-response", { method: "POST" });
  assert.equal(anonymous.status, 401);

  const customer = await createUser("USER");
  const ticket = await createCustomerTicket(customer.token);
  const response = await callAiApi(`/tickets/${ticket.id}/ai-response`, customer.token);
  const body = await response.json() as {
    data: { ticketId: string; generatedById: string; response: { customer_response: string } };
  };
  assert.equal(response.status, 201);
  assert.equal(body.data.ticketId, ticket.id);
  assert.equal(body.data.generatedById, customer.user.id);
  assert.ok(body.data.response.customer_response.length > 0);
});

test("le ticket retourné au support inclut le brouillon IA sans le montrer au client", async () => {
  const customer = await createUser("USER");
  const agent = await createUser("AGENT");
  const created = await callApi("/tickets", {
    method: "POST",
    token: customer.token,
    body: {
      title: "Connexion impossible",
      description: "Un message d'erreur s'affiche au login.",
      category: "AUTHENTICATION",
    },
  });
  const createdBody = await created.json() as { data: { id: string; status: string } };
  assert.equal(created.status, 201);
  createdTicketIds.push(createdBody.data.id);

  const response = await callAiApi(`/tickets/${createdBody.data.id}/ai-response`, agent.token);
  const body = await response.json() as {
    data: { id: string; ticketId: string; generatedById: string; model: string; response: { customer_response: string } };
  };
  assert.equal(response.status, 201);
  assert.equal(body.data.ticketId, createdBody.data.id);
  assert.equal(body.data.generatedById, agent.user.id);
  assert.equal(body.data.model, "mock-model");
  assert.match(body.data.response.customer_response, /préciser/);

  const stored = await prisma.ticketAiDraft.findUnique({ where: { id: body.data.id } });
  const unchangedTicket = await prisma.ticket.findUnique({ where: { id: createdBody.data.id } });
  assert.ok(stored);
  assert.equal(stored.generatedById, agent.user.id);
  assert.equal(unchangedTicket?.status, createdBody.data.status);

  const supportView = await callApi(`/tickets/${createdBody.data.id}`, { token: agent.token });
  const supportBody = await supportView.json() as {
    data: { customer_response: string | null };
  };
  assert.equal(supportView.status, 200);
  assert.match(supportBody.data.customer_response ?? "", /préciser/);
  assert.equal("aiResponse" in supportBody.data, false);

  const customerView = await callApi(`/tickets/${createdBody.data.id}`, { token: customer.token });
  const customerBody = await customerView.json() as { data: Record<string, unknown> };
  assert.equal(customerView.status, 200);
  assert.equal("aiResponse" in customerBody.data, false);
});

test("la conversation exige l'authentification, le rôle USER et la propriété du ticket", async () => {
  const owner = await createUser("USER");
  const other = await createUser("USER");
  const agent = await createUser("AGENT");
  const ticket = await createCustomerTicket(owner.token);

  const anonymous = await callAiApi(`/tickets/${ticket.id}/comments`, undefined, { method: "GET" });
  assert.equal(anonymous.status, 401);

  const otherUser = await callAiApi(`/tickets/${ticket.id}/comments`, other.token, { method: "GET" });
  assert.equal(otherUser.status, 403);
  const otherPost = await callAiApi(`/tickets/${ticket.id}/comments`, other.token, {
    body: { content: "Ne dois pas pouvoir commenter." },
  });
  assert.equal(otherPost.status, 403);

  const support = await callAiApi(`/tickets/${ticket.id}/comments`, agent.token, { method: "GET" });
  assert.equal(support.status, 403);
  const missing = await callAiApi("/tickets/00000000-0000-4000-8000-000000000001/comments", owner.token, { method: "GET" });
  assert.equal(missing.status, 404);
});

test("un commentaire USER déclenche une réponse AI et conserve les échanges dans l'ordre", async () => {
  conversationHarness.generationCalls = 0;
  const owner = await createUser("USER");
  const ticket = await createCustomerTicket(owner.token);

  const emptyConversation = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, { method: "GET" });
  const emptyBody = await emptyConversation.json() as { data: unknown[] };
  assert.equal(emptyConversation.status, 200);
  assert.deepEqual(emptyBody.data, []);

  const first = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "Je ne peux pas ouvrir l'application." },
  });
  const firstBody = await first.json() as {
    data: { userComment: { type: string; aiStatus: string }; aiReply: { type: string; content: string } };
  };
  assert.equal(first.status, 201);
  assert.equal(firstBody.data.userComment.type, "USER");
  assert.equal(firstBody.data.userComment.aiStatus, "COMPLETED");
  assert.equal(firstBody.data.aiReply.type, "AI");
  assert.match(firstBody.data.aiReply.content, /Réponse fictive/);

  const second = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "J'ai déjà redémarré, quelle est la suite ?" },
  });
  assert.equal(second.status, 201);

  const historyResponse = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, { method: "GET" });
  const history = await historyResponse.json() as { data: Array<{ type: string; content: string }> };
  assert.equal(history.data.length, 4);
  assert.deepEqual(history.data.map((comment) => comment.type), ["USER", "AI", "USER", "AI"]);
  assert.equal(history.data[0]?.content, "Je ne peux pas ouvrir l'application.");
  assert.equal(history.data[2]?.content, "J'ai déjà redémarré, quelle est la suite ?");
  assert.equal(conversationHarness.generationCalls, 2);
});

test("Zod refuse un commentaire vide sans appeler l'IA", async () => {
  conversationHarness.generationCalls = 0;
  const owner = await createUser("USER");
  const ticket = await createCustomerTicket(owner.token);

  const response = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "   " },
  });
  assert.equal(response.status, 400);
  assert.equal(conversationHarness.generationCalls, 0);
});

test("un ticket fermé refuse les commentaires avant l'appel IA", async () => {
  conversationHarness.generationCalls = 0;
  const owner = await createUser("USER");
  const agent = await createUser("AGENT");
  const ticket = await createCustomerTicket(owner.token);
  const closed = await callApi(`/tickets/${ticket.id}/status`, {
    method: "PATCH",
    token: agent.token,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200);

  const response = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "Mon problème continue." },
  });
  assert.equal(response.status, 409);
  assert.equal(conversationHarness.generationCalls, 0);
});

test("la limite est de 20 commentaires USER par ticket", async () => {
  conversationHarness.generationCalls = 0;
  const owner = await createUser("USER");
  const ticket = await createCustomerTicket(owner.token);

  for (let index = 1; index <= 20; index += 1) {
    const response = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
      body: { content: `Commentaire numéro ${index}` },
    });
    assert.equal(response.status, 201);
  }

  const twentyFirst = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "Ce commentaire dépasse la limite." },
  });
  assert.equal(twentyFirst.status, 409);
  assert.equal(conversationHarness.generationCalls, 20);

  const historyResponse = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, { method: "GET" });
  const history = await historyResponse.json() as { data: Array<{ type: string }> };
  assert.equal(history.data.filter((comment) => comment.type === "USER").length, 20);
  assert.equal(history.data.filter((comment) => comment.type === "AI").length, 20);
});

test("les requêtes simultanées ne lancent pas deux générations pour le même ticket", async () => {
  conversationHarness.generationCalls = 0;
  const owner = await createUser("USER");
  const ticket = await createCustomerTicket(owner.token);

  let signalStarted!: () => void;
  let releaseGeneration!: () => void;
  const generationStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  conversationHarness.waitForGeneration = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  conversationHarness.onGenerationStart = signalStarted;

  try {
    const firstRequest = callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
      body: { content: "Premier message simultané." },
    });
    await generationStarted;

    const secondRequest = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
      body: { content: "Deuxième message envoyé pendant la génération." },
    });
    assert.equal(secondRequest.status, 409);
    const secondBody = await secondRequest.json() as { error: { message: string } };
    assert.equal(secondBody.error.message, "Une réponse IA est déjà en cours pour ce ticket.");
    assert.equal(conversationHarness.generationCalls, 1);

    releaseGeneration();
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 201);
    assert.equal(conversationHarness.generationCalls, 1);

    const historyResponse = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, { method: "GET" });
    const history = await historyResponse.json() as { data: Array<{ type: string }> };
    assert.equal(history.data.filter((comment) => comment.type === "USER").length, 1);
  } finally {
    releaseGeneration();
    conversationHarness.waitForGeneration = undefined;
    conversationHarness.onGenerationStart = undefined;
  }
});

test("un échec IA conserve le commentaire avec FAILED; un POST répété n'est pas idempotent", async () => {
  conversationHarness.generationCalls = 0;
  conversationHarness.failNext = true;
  const owner = await createUser("USER");
  const ticket = await createCustomerTicket(owner.token);

  const failed = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "Même message envoyé une première fois." },
  });
  assert.equal(failed.status, 502);

  const afterFailure = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, { method: "GET" });
  const failedHistory = await afterFailure.json() as { data: Array<{ type: string; aiStatus: string | null }> };
  assert.equal(failedHistory.data.length, 1);
  assert.equal(failedHistory.data[0]?.type, "USER");
  assert.equal(failedHistory.data[0]?.aiStatus, "FAILED");

  const repeated = await callAiApi(`/tickets/${ticket.id}/comments`, owner.token, {
    body: { content: "Même message envoyé une première fois." },
  });
  assert.equal(repeated.status, 201);
  assert.equal(conversationHarness.generationCalls, 2);
});

test("le limiteur bloque les tentatives répétées de connexion", async () => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    response = await callApi("/auth/login", { method: "POST", body: { email: "unknown@example.test", password: "wrong-password" } });
  }
  assert.equal(response?.status, 429);
  const body = await response!.json() as { error: { code: string } };
  assert.equal(body.error.code, "TOO_MANY_REQUESTS");
});

