CREATE TYPE "TwoFactorMethod" AS ENUM ('email', 'sms');

CREATE TYPE "TwoFactorChallengeStatus" AS ENUM ('pending', 'verified', 'expired', 'failed', 'cancelled');

CREATE TABLE "user_security_settings" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(128) NOT NULL,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "preferred_2fa_method" "TwoFactorMethod",
    "email_2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "phone_number" VARCHAR(20),
    "phone_verified_at" TIMESTAMPTZ(3),
    "email_verified_at" TIMESTAMPTZ(3),
    "two_factor_enabled_at" TIMESTAMPTZ(3),
    "last_2fa_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "user_security_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_security_settings_user_id_key" ON "user_security_settings"("user_id");

CREATE TABLE "two_factor_challenges" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(128) NOT NULL,
    "method" "TwoFactorMethod" NOT NULL,
    "destination_reference" VARCHAR(255) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "challenge_token_hash" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "status" "TwoFactorChallengeStatus" NOT NULL DEFAULT 'pending',
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "two_factor_challenges_user_id_status_created_at_idx" ON "two_factor_challenges"("user_id", "status", "created_at");
CREATE INDEX "two_factor_challenges_challenge_token_hash_idx" ON "two_factor_challenges"("challenge_token_hash");

ALTER TABLE "user_security_settings" ADD CONSTRAINT "user_security_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
