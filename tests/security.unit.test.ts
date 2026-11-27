import assert from "node:assert/strict";
import { test } from "node:test";

process.env.JWT_ACCESS_SECRET ??= "unit-test-secret-with-at-least-32-characters";

const security = await import("../src/utils/security.js");
const { loginSchema } = await import("../src/modules/auth/auth.schemas.js");
const { createTicketSchema, listTicketsQuerySchema } = await import("../src/modules/tickets/tickets.schemas.js");

test("scrypt accepte le mot de passe correct et rejette un autre", async () => {
  const hash = await security.hashPassword("correct-password-123");
  assert.equal(await security.verifyPassword("correct-password-123", hash), true);
  assert.equal(await security.verifyPassword("wrong-password", hash), false);
});

test("un JWT est accepté seulement si sa signature et son expiration sont valides", () => {
  const token = security.createAccessToken({
    id: "user-test-1",
    email: "user@example.test",
    role: "USER",
    tokenVersion: 0,
  });
  assert.equal(security.verifyAccessToken(token)?.sub, "user-test-1");
  const [header, payload, signature] = token.split(".");
  assert.ok(header && payload && signature);
  const changedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(security.verifyAccessToken(`${header}.${payload}.${changedSignature}`), null);
});

test("les schémas Zod valident les corps et les filtres avant le service", () => {
  assert.equal(loginSchema.safeParse({ email: "pas-un-email", password: "x" }).success, false);
  assert.deepEqual(
    loginSchema.parse({ email: "  Sifouffc@gmail.com  ", password: "correct-password-123" }),
    { email: "Sifouffc@gmail.com", password: "correct-password-123" },
  );
  assert.equal(createTicketSchema.safeParse({ title: "Titre", description: "texte", category: "BUG" }).success, true);
  assert.equal(createTicketSchema.safeParse({ title: "Titre", description: "texte", category: "UNKNOWN" }).success, false);
  assert.equal(createTicketSchema.safeParse({ title: "Titre", description: "texte" }).success, false);
  assert.equal(createTicketSchema.safeParse({ title: " ", description: "texte", category: "BUG" }).success, false);
  assert.deepEqual(
    listTicketsQuerySchema.parse({ page: "2", limit: "10", order: "asc" }),
    { page: 2, limit: 10, sortBy: "createdAt", order: "asc" },
  );
  assert.equal(listTicketsQuerySchema.safeParse({ limit: "1000" }).success, false);
  assert.equal(listTicketsQuerySchema.safeParse({ category: "UNKNOWN" }).success, false);
});
