-- AlterTable
ALTER TABLE "campaign_sends" ADD COLUMN "tracking_token" TEXT;

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" TEXT NOT NULL,
    "campaign_send_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tracking_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "campaign_send_id" TEXT,
    "tracking_link_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sends_tracking_token_key" ON "campaign_sends"("tracking_token");

-- CreateIndex
CREATE INDEX "tracking_links_campaign_send_id_idx" ON "tracking_links"("campaign_send_id");

-- CreateIndex
CREATE INDEX "email_tracking_events_campaign_send_id_idx" ON "email_tracking_events"("campaign_send_id");

-- CreateIndex
CREATE INDEX "email_tracking_events_type_idx" ON "email_tracking_events"("type");

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_send_id_fkey" FOREIGN KEY ("campaign_send_id") REFERENCES "campaign_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracking_events" ADD CONSTRAINT "email_tracking_events_campaign_send_id_fkey" FOREIGN KEY ("campaign_send_id") REFERENCES "campaign_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracking_events" ADD CONSTRAINT "email_tracking_events_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
