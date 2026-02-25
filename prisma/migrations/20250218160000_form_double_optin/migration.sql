-- Double opt-in for forms (Phase 16)
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "require_confirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "confirm_redirect_url" TEXT;

CREATE TABLE IF NOT EXISTS "form_confirmation_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_confirmation_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_confirmation_tokens_token_key" ON "form_confirmation_tokens"("token");
CREATE INDEX IF NOT EXISTS "form_confirmation_tokens_form_id_idx" ON "form_confirmation_tokens"("form_id");
CREATE INDEX IF NOT EXISTS "form_confirmation_tokens_expires_at_idx" ON "form_confirmation_tokens"("expires_at");

ALTER TABLE "form_confirmation_tokens" ADD CONSTRAINT "form_confirmation_tokens_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_confirmation_tokens" ADD CONSTRAINT "form_confirmation_tokens_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_confirmation_tokens" ADD CONSTRAINT "form_confirmation_tokens_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
