CREATE TABLE IF NOT EXISTS "chat_sessions" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(128),
    "user_role" VARCHAR(20),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_sessions_user_id_started_at_idx" ON "chat_sessions"("user_id", "started_at");
CREATE INDEX IF NOT EXISTS "chat_sessions_started_at_idx" ON "chat_sessions"("started_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_user_id_fkey'
    ) THEN
        ALTER TABLE "chat_sessions"
            ADD CONSTRAINT "chat_sessions_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
