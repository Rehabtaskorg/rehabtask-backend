CREATE TABLE "signup_phone_challenges" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "ip_address" VARCHAR(64) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "signup_phone_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "signup_phone_challenges_phone_created_at_idx" ON "signup_phone_challenges"("phone", "created_at");
CREATE INDEX "signup_phone_challenges_ip_address_created_at_idx" ON "signup_phone_challenges"("ip_address", "created_at");
