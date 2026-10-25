ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "communication_rating" INTEGER;

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "documentation_rating" INTEGER;

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "professionalism_rating" INTEGER;

UPDATE "reviews"
SET "communication_rating"   = "rating",
    "documentation_rating"   = "rating",
    "professionalism_rating" = "rating"
WHERE "communication_rating" IS NULL
   OR "documentation_rating" IS NULL
   OR "professionalism_rating" IS NULL;
