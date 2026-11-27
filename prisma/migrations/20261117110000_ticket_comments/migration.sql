CREATE TYPE "CommentType" AS ENUM ('USER', 'AI');

CREATE TYPE "AiGenerationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "CommentType" NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiStatus" "AiGenerationStatus",
    "replyToId" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Comment_replyToId_key" ON "Comment"("replyToId");
CREATE INDEX "Comment_ticketId_createdAt_id_idx" ON "Comment"("ticketId", "createdAt", "id");
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Comment"
    ADD CONSTRAINT "Comment_replyToId_fkey"
    FOREIGN KEY ("replyToId") REFERENCES "Comment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
