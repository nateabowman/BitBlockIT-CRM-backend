ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "sms_opt_out_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "dnc_at" TIMESTAMP(3);
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'email';

CREATE TABLE IF NOT EXISTS "assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT,
    "is_gated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);
