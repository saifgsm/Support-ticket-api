import { z } from "zod";
import { TicketCategory as PrismaTicketCategory } from "@prisma/client";

// Prisma fournit la liste des valeurs autorisées; Zod la réutilise pour valider
// les entrées HTTP sans maintenir une deuxième liste différente.
export const ticketCategorySchema = z.enum(PrismaTicketCategory);

// Zod bloque les titres/descriptions vides ou trop longs avant l'accès à la base.
export const createTicketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10000),
  category: ticketCategorySchema,
});

export const updateTicketStatusSchema = z.object({
  // Une liste fermée de valeurs évite d'enregistrer un état arbitraire.
  status: z.enum(["open", "in_progress", "closed"]),
});

export const ticketUuidSchema = z.uuid();

export const ticketIdParamsSchema = z.object({
  id: ticketUuidSchema,
});

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  category: ticketCategorySchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(["createdAt", "title", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type TicketIdParams = z.infer<typeof ticketIdParamsSchema>;
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
