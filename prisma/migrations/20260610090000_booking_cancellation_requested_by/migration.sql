ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "cancellation_requested_by" VARCHAR(20);