-- AlterTable Contact: preference center, unsubscribe token, bounce
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "preference_center_frequency" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "topic_preferences" JSONB;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "unsubscribe_token" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "bounced_at" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_unsubscribe_token_key" ON "contacts"("unsubscribe_token");

-- AlterTable Segment: exclude segment, type
ALTER TABLE "segments" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'static';
ALTER TABLE "segments" ADD COLUMN IF NOT EXISTS "exclude_segment_id" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segments_exclude_segment_id_fkey') THEN
    ALTER TABLE "segments" ADD CONSTRAINT "segments_exclude_segment_id_fkey" FOREIGN KEY ("exclude_segment_id") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "segments_exclude_segment_id_idx" ON "segments"("exclude_segment_id");
