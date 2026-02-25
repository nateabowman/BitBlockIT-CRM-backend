-- Contact consent fields (Phase 93)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_source" VARCHAR(64);
