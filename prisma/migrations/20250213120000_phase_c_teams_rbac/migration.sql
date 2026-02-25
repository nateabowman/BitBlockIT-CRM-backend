-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "team_id" TEXT,
ADD COLUMN "signature" TEXT,
ADD COLUMN "notification_prefs" JSONB,
ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reset_token" TEXT,
ADD COLUMN "reset_token_expires" TIMESTAMP(3),
ADD COLUMN "invite_token" TEXT,
ADD COLUMN "invite_token_expires" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_team_id_idx" ON "users"("team_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
