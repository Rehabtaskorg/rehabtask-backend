ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'cancellation_requested';

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at"  TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cancellation_requested_by"  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "pre_cancellation_status"    VARCHAR(50);
