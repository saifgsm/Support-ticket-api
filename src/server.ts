
import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

type TicketStatus = "open" | "in_progress" | "closed";

const allowedStatuses: TicketStatus[] = [
  "open",
  "in_progress",
  "closed",
];

// GET : récupérer tous les tickets
app.get("/tickets", async (_req, res) => {
  const tickets = await prisma.ticket.findMany();
  return res.json(tickets);
});

// POST : créer un ticket
app.post("/tickets", async (req, res) => {
  const { title, description } = req.body;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    return res.status(400).json({
      error: "Le titre et la description sont obligatoires.",
    });
  }

  const ticket = await prisma.ticket.create({
    data: {
      title: title.trim(),
      description: description.trim(),
    },
  });

  return res.status(201).json(ticket);
});

// GET : récupérer un ticket par son ID
app.get("/tickets/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "ID invalide." });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
  });

  if (!ticket) {
    return res.status(404).json({
      error: "Ticket introuvable.",
    });
  }

  return res.json(ticket);
});

// PATCH : modifier le statut d'un ticket
app.patch("/tickets/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "ID invalide." });
  }

  if (
    typeof status !== "string" ||
    !allowedStatuses.includes(status as TicketStatus)
  ) {
    return res.status(400).json({
      error: "Statut invalide.",
      allowedStatuses,
    });
  }

  const existingTicket = await prisma.ticket.findUnique({
    where: { id },
  });

  if (!existingTicket) {
    return res.status(404).json({
      error: "Ticket introuvable.",
    });
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data: { status },
  });

  return res.json(ticket);
});

app.listen(3000, () => {
  console.log("Support Ticket API: http://localhost:3000");
});
