-- AlterTable: Add zip_code column with backfill for existing rows
ALTER TABLE "work_areas" ADD COLUMN "zip_code" VARCHAR(10);

-- Backfill existing rows with placeholder (these therapists entered ZIPs that were discarded)
UPDATE "work_areas" SET "zip_code" = '00000' WHERE "zip_code" IS NULL;

-- Now make the column required
ALTER TABLE "work_areas" ALTER COLUMN "zip_code" SET NOT NULL;
