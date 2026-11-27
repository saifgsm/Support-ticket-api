-- The application now uses UUIDs for ticket IDs. Temporary UUID columns let us
-- preserve every ticket and remap its comments and AI drafts before replacing
-- the old integer key. The transaction keeps this conversion all-or-nothing.
BEGIN;

ALTER TABLE "Ticket" ADD COLUMN "id_uuid_new" UUID;
UPDATE "Ticket" SET "id_uuid_new" = gen_random_uuid();
ALTER TABLE "Ticket" ALTER COLUMN "id_uuid_new" SET NOT NULL;

ALTER TABLE "TicketAiDraft" ADD COLUMN "ticketId_uuid_new" UUID;
UPDATE "TicketAiDraft" AS draft
SET "ticketId_uuid_new" = ticket."id_uuid_new"
FROM "Ticket" AS ticket
WHERE draft."ticketId" = ticket."id";
ALTER TABLE "TicketAiDraft" ALTER COLUMN "ticketId_uuid_new" SET NOT NULL;

ALTER TABLE "Comment" ADD COLUMN "ticketId_uuid_new" UUID;
UPDATE "Comment" AS comment
SET "ticketId_uuid_new" = ticket."id_uuid_new"
FROM "Ticket" AS ticket
WHERE comment."ticketId" = ticket."id";
ALTER TABLE "Comment" ALTER COLUMN "ticketId_uuid_new" SET NOT NULL;

ALTER TABLE "TicketAiDraft" DROP CONSTRAINT "TicketAiDraft_ticketId_fkey";
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_ticketId_fkey";
DROP INDEX "TicketAiDraft_ticketId_createdAt_idx";
DROP INDEX "Comment_ticketId_createdAt_id_idx";
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_pkey";

ALTER TABLE "TicketAiDraft" DROP COLUMN "ticketId";
ALTER TABLE "Comment" DROP COLUMN "ticketId";
ALTER TABLE "Ticket" DROP COLUMN "id";

ALTER TABLE "Ticket" RENAME COLUMN "id_uuid_new" TO "id";
ALTER TABLE "TicketAiDraft" RENAME COLUMN "ticketId_uuid_new" TO "ticketId";
ALTER TABLE "Comment" RENAME COLUMN "ticketId_uuid_new" TO "ticketId";

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id");
ALTER TABLE "TicketAiDraft"
    ADD CONSTRAINT "TicketAiDraft_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TicketAiDraft_ticketId_createdAt_idx"
    ON "TicketAiDraft"("ticketId", "createdAt");
CREATE INDEX "Comment_ticketId_createdAt_id_idx"
    ON "Comment"("ticketId", "createdAt", "id");

COMMIT;
