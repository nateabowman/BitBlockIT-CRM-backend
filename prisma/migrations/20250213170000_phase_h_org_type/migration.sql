-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'prospect';

-- CreateIndex
CREATE INDEX "organizations_type_idx" ON "organizations"("type");
