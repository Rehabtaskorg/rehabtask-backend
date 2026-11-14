ALTER TABLE "therapist_profiles"
  ADD COLUMN IF NOT EXISTS "emr" VARCHAR(100);

ALTER TABLE "therapist_profiles"
  ADD COLUMN IF NOT EXISTS "emr_other" VARCHAR(100);
