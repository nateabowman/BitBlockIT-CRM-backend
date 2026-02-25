-- CreateTable PageView
CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "referrer" TEXT,
    "user_agent" TEXT,
    "device_type" TEXT,
    "ip" TEXT,
    "geo" JSONB,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_views_visitor_id_idx" ON "page_views"("visitor_id");
CREATE INDEX "page_views_contact_id_idx" ON "page_views"("contact_id");
CREATE INDEX "page_views_lead_id_idx" ON "page_views"("lead_id");
CREATE INDEX "page_views_created_at_idx" ON "page_views"("created_at");
CREATE INDEX "page_views_utm_idx" ON "page_views"("utm_source", "utm_medium", "utm_campaign");

-- CreateTable VisitorEvent
CREATE TABLE "visitor_events" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "name" TEXT NOT NULL,
    "properties" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_events_visitor_id_idx" ON "visitor_events"("visitor_id");
CREATE INDEX "visitor_events_contact_id_idx" ON "visitor_events"("contact_id");
CREATE INDEX "visitor_events_lead_id_idx" ON "visitor_events"("lead_id");
CREATE INDEX "visitor_events_name_idx" ON "visitor_events"("name");
CREATE INDEX "visitor_events_created_at_idx" ON "visitor_events"("created_at");
