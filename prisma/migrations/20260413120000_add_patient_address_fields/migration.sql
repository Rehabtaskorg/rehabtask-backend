-- AlterTable: make email nullable (existing rows keep their values)
ALTER TABLE "patients" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable: add address fields (all nullable for backward compatibility)
ALTER TABLE "patients"
  ADD COLUMN "address_line_1" VARCHAR(255),
  ADD COLUMN "address_line_2" VARCHAR(255),
  ADD COLUMN "city"           VARCHAR(100),
  ADD COLUMN "state"          VARCHAR(50),
  ADD COLUMN "zip_code"       VARCHAR(10),
  ADD COLUMN "latitude"       DECIMAL(10, 8),
  ADD COLUMN "longitude"      DECIMAL(11, 8);

-- CreateIndex: geo lookup on patient addresses
CREATE INDEX "patients_latitude_longitude_idx" ON "patients" ("latitude", "longitude");
