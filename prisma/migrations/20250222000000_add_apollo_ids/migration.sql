-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "apollo_person_id" TEXT,
ADD COLUMN "apollo_contact_id" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "apollo_organization_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_apollo_organization_id_key" ON "organizations"("apollo_organization_id");
