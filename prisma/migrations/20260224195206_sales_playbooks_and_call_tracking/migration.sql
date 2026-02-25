-- AlterTable
ALTER TABLE "call_records" ADD COLUMN     "disposition" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "outcome_score" INTEGER,
ADD COLUMN     "script_playbook_id" TEXT,
ADD COLUMN     "sentiment" TEXT;

-- CreateTable
CREATE TABLE "sales_playbooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_playbooks_slug_key" ON "sales_playbooks"("slug");

-- CreateIndex
CREATE INDEX "call_records_script_playbook_id_idx" ON "call_records"("script_playbook_id");

-- AddForeignKey
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_script_playbook_id_fkey" FOREIGN KEY ("script_playbook_id") REFERENCES "sales_playbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
