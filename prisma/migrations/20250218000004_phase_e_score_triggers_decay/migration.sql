CREATE TABLE "score_triggers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_triggers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_score_decay_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "points_per_day" INTEGER NOT NULL,
    "no_activity_days" INTEGER NOT NULL,
    "min_score" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_score_decay_rules_pkey" PRIMARY KEY ("id")
);
