-- AlterTable
ALTER TABLE "call_records" ALTER COLUMN "lead_id" DROP NOT NULL,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "call_records_direction_idx" ON "call_records"("direction");
