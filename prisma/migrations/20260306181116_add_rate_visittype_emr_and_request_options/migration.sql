-- AlterTable
ALTER TABLE "therapy_requests" ADD COLUMN     "emr" VARCHAR(100),
ADD COLUMN     "rate" DECIMAL(10,2),
ADD COLUMN     "visit_type" VARCHAR(100);

-- CreateTable
CREATE TABLE "request_options" (
    "id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_options_type_idx" ON "request_options"("type");

-- CreateIndex
CREATE UNIQUE INDEX "request_options_type_value_key" ON "request_options"("type", "value");

-- Seed default visit type options
INSERT INTO "request_options" ("id", "type", "value", "is_default") VALUES
  (gen_random_uuid(), 'visit_type', 'Initial Evaluation', true),
  (gen_random_uuid(), 'visit_type', 'Follow-Up Visit', true),
  (gen_random_uuid(), 'visit_type', 'Re-Evaluation', true),
  (gen_random_uuid(), 'visit_type', 'Discharge Visit', true);

-- Seed default EMR options
INSERT INTO "request_options" ("id", "type", "value", "is_default") VALUES
  (gen_random_uuid(), 'emr', 'Axxess', true),
  (gen_random_uuid(), 'emr', 'KanTime', true),
  (gen_random_uuid(), 'emr', 'WellSky', true),
  (gen_random_uuid(), 'emr', 'PointCare', true),
  (gen_random_uuid(), 'emr', 'HCHB (HomeCare HomeBase)', true),
  (gen_random_uuid(), 'emr', 'MatrixCare', true);
