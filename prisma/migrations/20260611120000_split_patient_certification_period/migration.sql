ALTER TABLE "patients" ADD COLUMN "certification_start" DATE,
ADD COLUMN "certification_end" DATE;

UPDATE "patients" SET "certification_end" = "certification_expiry" WHERE "certification_expiry" IS NOT NULL;

ALTER TABLE "patients" DROP COLUMN "certification_expiry";
