-- Landing page body (optional content)
ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "body" TEXT;

-- Per-template from name/email (Phase 82)
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "from_name" TEXT;
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "from_email" TEXT;
