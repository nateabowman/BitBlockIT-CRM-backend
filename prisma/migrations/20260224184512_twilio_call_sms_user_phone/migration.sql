-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "call_records" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "user_id" TEXT NOT NULL,
    "twilio_call_sid" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_seconds" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "twilio_message_sid" TEXT,
    "status" TEXT,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_records_twilio_call_sid_key" ON "call_records"("twilio_call_sid");

-- CreateIndex
CREATE INDEX "call_records_lead_id_idx" ON "call_records"("lead_id");

-- CreateIndex
CREATE INDEX "call_records_user_id_idx" ON "call_records"("user_id");

-- CreateIndex
CREATE INDEX "sms_messages_contact_id_idx" ON "sms_messages"("contact_id");

-- CreateIndex
CREATE INDEX "sms_messages_lead_id_idx" ON "sms_messages"("lead_id");

-- CreateIndex
CREATE INDEX "sms_messages_twilio_message_sid_idx" ON "sms_messages"("twilio_message_sid");

-- AddForeignKey
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "page_views_utm_idx" RENAME TO "page_views_utm_source_utm_medium_utm_campaign_idx";
