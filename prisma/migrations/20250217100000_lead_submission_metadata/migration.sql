-- AlterTable
ALTER TABLE "leads" ADD COLUMN "ip" TEXT,
ADD COLUMN "user_agent" TEXT,
ADD COLUMN "referrer" TEXT,
ADD COLUMN "submission_meta" JSONB;
