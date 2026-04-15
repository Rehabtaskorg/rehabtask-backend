-- Missed Visit support
-- Additive: new enum value, new enum type, new nullable columns, new nullable FK

-- 1. Add `missed` to SessionStatus enum
ALTER TYPE "SessionStatus" ADD VALUE 'missed';

-- 2. Create MissedByRole enum
CREATE TYPE "MissedByRole" AS ENUM ('therapist', 'customer');

-- 3. Add missed-visit tracking columns to sessions (all nullable)
ALTER TABLE "sessions"
  ADD COLUMN "missed_reason" VARCHAR(500),
  ADD COLUMN "missed_by"     "MissedByRole",
  ADD COLUMN "missed_at"     TIMESTAMPTZ(3);

-- 4. Add nullable session_id to customer_refunds (per-session refund tracking)
ALTER TABLE "customer_refunds"
  ADD COLUMN "session_id" UUID;

-- 5. FK: customer_refunds.session_id -> sessions.id (nullable, ON DELETE SET NULL)
ALTER TABLE "customer_refunds"
  ADD CONSTRAINT "customer_refunds_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Index for session-based refund lookups
CREATE INDEX "customer_refunds_session_id_idx" ON "customer_refunds" ("session_id");
