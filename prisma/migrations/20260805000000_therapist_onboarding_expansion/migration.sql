-- CreateTable: therapist_attributes junction table
-- Stores multi-select therapist fields (specialties, languages, certifications,
-- past settings, population experience) as indexed rows rather than array columns,
-- enabling fast agency search filters via JOIN instead of array containment scans.
CREATE TABLE "therapist_attributes" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "therapist_id" UUID         NOT NULL,
    "category"     VARCHAR(64)  NOT NULL,
    "value"        VARCHAR(128) NOT NULL,
    "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapist_attributes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "therapist_attributes_therapist_id_category_value_key" UNIQUE ("therapist_id", "category", "value")
);

ALTER TABLE "therapist_attributes"
    ADD CONSTRAINT "therapist_attributes_therapist_id_fkey"
    FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "therapist_attributes_therapist_id_category_idx" ON "therapist_attributes"("therapist_id", "category");

CREATE INDEX "therapist_attributes_category_value_idx" ON "therapist_attributes"("category", "value");

ALTER TABLE "therapist_profiles"
    ADD COLUMN "years_in_home_health" INTEGER,
    ADD COLUMN "evaluation_rate"      DECIMAL(10,2),
    ADD COLUMN "travel_fee"           DECIMAL(10,2),
    ADD COLUMN "available_from"       TIMESTAMPTZ(3),
    ADD COLUMN "caseload_capacity"    INTEGER,
    ADD COLUMN "hipaa_attested"       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "hipaa_attested_at"    TIMESTAMPTZ(3);

INSERT INTO "therapist_attributes" ("therapist_id", "category", "value")
SELECT "id", 'specialty', "specialization"
FROM "therapist_profiles"
WHERE "specialization" IS NOT NULL AND "specialization" <> ''
ON CONFLICT DO NOTHING;