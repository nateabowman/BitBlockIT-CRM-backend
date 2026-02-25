-- Campaign send failure tracking (Phase 88)
ALTER TABLE "campaign_sends" ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3);
ALTER TABLE "campaign_sends" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
