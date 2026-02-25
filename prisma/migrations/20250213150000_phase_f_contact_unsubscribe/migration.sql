-- Phase F: Unsubscribe handling
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "unsubscribed_at" TIMESTAMP(3);
