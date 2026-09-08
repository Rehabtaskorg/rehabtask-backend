-- Phase 1: re-review tracking for post-approval profile/document edits.
-- NULL = no pending change. Non-NULL = timestamp the change was submitted.
-- Additive only: nullable, no default, no backfill — existing rows are unaffected.

ALTER TABLE "therapist_profiles"
  ADD COLUMN IF NOT EXISTS "pending_review_at" TIMESTAMPTZ(3);

ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "pending_review_at" TIMESTAMPTZ(3);

-- Partial indexes: the admin queue only ever queries WHERE pending_review_at IS NOT NULL,
-- which will be a small minority of rows. Indexing only those keeps the index tiny.
-- NOTE: Prisma's @@index cannot express a WHERE clause, so schema.prisma declares a plain
-- index with a matching `map:` name. The names must stay in sync or migrate diff reports drift.
CREATE INDEX IF NOT EXISTS "idx_therapist_profiles_pending_review"
  ON "therapist_profiles" ("pending_review_at")
  WHERE "pending_review_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_customer_profiles_pending_review"
  ON "customer_profiles" ("pending_review_at")
  WHERE "pending_review_at" IS NOT NULL;
