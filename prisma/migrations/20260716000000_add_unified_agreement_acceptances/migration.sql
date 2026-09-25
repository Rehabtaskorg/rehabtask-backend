CREATE TABLE "unified_agreement_acceptances" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           VARCHAR(128) NOT NULL,
    "user_role"         VARCHAR(20) NOT NULL,
    "agreement_version" VARCHAR(20) NOT NULL,
    "accepted_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "ip_address"        VARCHAR(45),
    "user_agent"        TEXT,

    CONSTRAINT "unified_agreement_acceptances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unified_agreement_acceptances_user_id_agreement_version_key"
        UNIQUE ("user_id", "agreement_version"),
    CONSTRAINT "unified_agreement_acceptances_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "unified_agreement_acceptances_user_id_idx"
    ON "unified_agreement_acceptances"("user_id");
