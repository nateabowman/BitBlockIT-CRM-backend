-- AlterTable: add schedule_config to campaigns
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "schedule_config" JSONB;

-- CreateTable: suppression list
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_type_value_key" ON "suppression_entries"("type", "value");
CREATE INDEX "suppression_entries_type_idx" ON "suppression_entries"("type");
