ALTER TABLE "therapist_profiles"
    ADD COLUMN "additional_license_states" TEXT[] NOT NULL DEFAULT '{}';
