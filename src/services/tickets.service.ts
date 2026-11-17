import type { Role } from "@prisma/client";

import { ApiError } from "../errors.js";
import { prisma } from "../db.js";
import { ticketAiResponseSchema } from "../modules/tickets/ticket-ai.schemas.js";
import { ticketUuidSchema } from "../modules/tickets/tickets.schemas.js";
import type {
  CreateTicketInput,
  ListTicketsQuery,
  UpdateTicketStatusInput,
} from "../modules/tickets/tickets.schemas.js";

// Les services portent les règles métier et parlent à Prisma; ils ne connaissent
// pas Express, les URL ou le format des réponses HTTP.
export async function listTickets(userId: string, role: Role, query: ListTicketsQuery) {
  // Les propriétés utilisées dans where/orderBy proviennent de valeurs validées
  // par Zod. Prisma transforme les valeurs en paramètres SQL, sans concaténer du SQL.
  const where = {
    ...(role === "USER" ? { createdById: userId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? {
      OR: [
        { title: { contains: query.q, mode: "insensitive" as const } },
        { description: { contains: query.q, mode: "insensitive" as const } },
      ],
    } : {}),
  };
  const skip = (query.page - 1) * query.limit;
  const [items, totalItems] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy: { [query.sortBy]: query.order },
      skip,
      take: query.limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function createTicket(userId: string, input: CreateTicketInput) {
  const { title, description, category } = input;
  return prisma.ticket.create({
    data: {
      title: title.trim(),
      description: description.trim(),
      category,
      // On enregistre le propriétaire depuis l'identité authentifiée, jamais depuis
      // un champ fourni par le client, pour éviter qu'il crée un ticket au nom d'autrui.
      createdById: userId,
    },
  });
}

export async function getTicket(idInput: string, userId: string, role: Role) {
  const parsedId = ticketUuidSchema.safeParse(idInput);
  if (!parsedId.success) throw new ApiError(400, "ID invalide.");
  const id = parsedId.data;

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  // Pour un utilisateur standard, une ressource appartenant à quelqu'un d'autre
  // est présentée comme introuvable afin de ne pas révéler qu'elle existe.
  if (!ticket || (role === "USER" && ticket.createdById !== userId)) {
    throw new ApiError(404, "Ticket introuvable.");
  }

  // Le brouillon reste réservé aux rôles support : l'inclure dans la réponse du
  // client reviendrait à lui montrer une réponse qui n'a pas encore été validée.
  if (role === "USER") return ticket;

  const latestDraft = await prisma.ticketAiDraft.findFirst({
    where: { ticketId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { response: true },
  });
  const parsedResponse = latestDraft
    ? ticketAiResponseSchema.safeParse(latestDraft.response)
    : null;

  return {
    ...ticket,
    customer_response: parsedResponse?.success ? parsedResponse.data.customer_response : null,
  };
}

export async function updateTicketStatus(
  idInput: string,
  input: UpdateTicketStatusInput,
) {
  const parsedId = ticketUuidSchema.safeParse(idInput);
  if (!parsedId.success) throw new ApiError(400, "ID invalide.");
  const id = parsedId.data;
  const { status } = input;

  const existingTicket = await prisma.ticket.findUnique({ where: { id } });
  if (!existingTicket) throw new ApiError(404, "Ticket introuvable.");
  return prisma.ticket.update({ where: { id }, data: { status } });
}
