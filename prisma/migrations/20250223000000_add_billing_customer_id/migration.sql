-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "billing_customer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_billing_customer_id_key" ON "organizations"("billing_customer_id");
