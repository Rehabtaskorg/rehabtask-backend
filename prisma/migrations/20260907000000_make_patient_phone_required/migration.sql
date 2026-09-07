-- Backfill any remaining rows with a placeholder before enforcing the constraint.
-- Dev was backfilled manually (8 rows); production had 0 nulls. This is a defensive no-op.
UPDATE "patients" SET "phone" = '+10000000000' WHERE "phone" IS NULL OR btrim("phone") = '';

-- Now make the column required
ALTER TABLE "patients" ALTER COLUMN "phone" SET NOT NULL;
