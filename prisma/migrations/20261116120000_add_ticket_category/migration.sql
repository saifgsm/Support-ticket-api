CREATE TYPE "TicketCategory" AS ENUM (
    'AUTHENTICATION',
    'DISPLAY',
    'PERFORMANCE',
    'NETWORK',
    'BUG',
    'PAYMENT',
    'ACCOUNT',
    'OTHER'
);

-- La colonne est d'abord nullable pour permettre le remplissage des tickets existants.
ALTER TABLE "Ticket" ADD COLUMN "category" "TicketCategory";
UPDATE "Ticket" SET "category" = 'OTHER' WHERE "category" IS NULL;
ALTER TABLE "Ticket" ALTER COLUMN "category" SET NOT NULL;
