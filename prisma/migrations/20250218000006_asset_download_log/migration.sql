CREATE TABLE "asset_download_logs" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "email" TEXT,
    "downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_download_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_download_logs_asset_id_idx" ON "asset_download_logs"("asset_id");
CREATE INDEX "asset_download_logs_contact_id_idx" ON "asset_download_logs"("contact_id");
CREATE INDEX "asset_download_logs_downloaded_at_idx" ON "asset_download_logs"("downloaded_at");

ALTER TABLE "asset_download_logs" ADD CONSTRAINT "asset_download_logs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
