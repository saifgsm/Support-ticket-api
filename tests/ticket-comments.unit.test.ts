import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTicketCommentSchema,
  ticketCommentParamsSchema,
} from "../src/modules/tickets/ticket-comments.schemas.js";

test("Zod valide les paramètres de commentaire comme UUID", () => {
  assert.equal(ticketCommentParamsSchema.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" }).success, true);
  assert.equal(ticketCommentParamsSchema.safeParse({ id: "42" }).success, false);
  assert.equal(ticketCommentParamsSchema.safeParse({ id: "not-a-uuid" }).success, false);
});

test("le contenu est obligatoire, nettoyé et borné; authorId du body est ignoré", () => {
  assert.deepEqual(
    createTicketCommentSchema.parse({ content: "  Bonjour  ", authorId: "fake-user" }),
    { content: "Bonjour" },
  );
  assert.equal(createTicketCommentSchema.safeParse({ content: "   " }).success, false);
  assert.equal(createTicketCommentSchema.safeParse({ content: "a".repeat(4001) }).success, false);
});
