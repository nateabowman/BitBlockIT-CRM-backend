-- AlterTable
ALTER TABLE "sms_messages" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "sms_messages_user_id_idx" ON "sms_messages"("user_id");

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
