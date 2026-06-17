ALTER TABLE "therapist_profiles"
    ADD COLUMN "date_of_birth" DATE,
    ADD COLUMN "address_line_1" VARCHAR(255),
    ADD COLUMN "address_line_2" VARCHAR(255),
    ADD COLUMN "city" VARCHAR(100),
    ADD COLUMN "state" VARCHAR(2),
    ADD COLUMN "zip_code" VARCHAR(10),
    ADD COLUMN "latitude" DECIMAL(10, 8),
    ADD COLUMN "longitude" DECIMAL(11, 8),
    ADD COLUMN "emergency_contact_name" VARCHAR(255),
    ADD COLUMN "emergency_contact_phone" VARCHAR(20),
    ADD COLUMN "npi_number" VARCHAR(10);

-- CreateIndex: npi_number must be unique per therapist
CREATE UNIQUE INDEX "therapist_profiles_npi_number_key" ON "therapist_profiles"("npi_number");