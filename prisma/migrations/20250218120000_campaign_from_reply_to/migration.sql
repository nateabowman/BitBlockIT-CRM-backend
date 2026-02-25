-- AlterTable: per-campaign from name, from email, reply-to
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "from_name" TEXT;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "from_email" TEXT;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "reply_to" TEXT;
