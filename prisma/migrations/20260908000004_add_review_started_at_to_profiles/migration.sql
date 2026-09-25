-- Marks when an account entered `review`, so the admin UI can flag documents
-- and data that changed after the reviewer started looking.
ALTER TABLE "therapist_profiles"
  ADD COLUMN IF NOT EXISTS "review_started_at" TIMESTAMPTZ(3);

ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "review_started_at" TIMESTAMPTZ(3);
