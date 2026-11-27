CREATE TABLE "TicketAiDraft" (
    "id" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "generatedById" TEXT,
    "model" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAiDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketAiDraft_ticketId_createdAt_idx"
    ON "TicketAiDraft"("ticketId", "createdAt");
CREATE INDEX "TicketAiDraft_generatedById_createdAt_idx"
    ON "TicketAiDraft"("generatedById", "createdAt");

ALTER TABLE "TicketAiDraft"
    ADD CONSTRAINT "TicketAiDraft_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAiDraft"
    ADD CONSTRAINT "TicketAiDraft_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
