-- CreateTable
CREATE TABLE "form_submission_logs" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "form_submission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_submission_logs_form_id_idx" ON "form_submission_logs"("form_id");

-- CreateIndex
CREATE INDEX "form_submission_logs_submitted_at_idx" ON "form_submission_logs"("submitted_at");

-- AddForeignKey
ALTER TABLE "form_submission_logs" ADD CONSTRAINT "form_submission_logs_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission_logs" ADD CONSTRAINT "form_submission_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission_logs" ADD CONSTRAINT "form_submission_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
