-- CA-1: Customer Approval Module — approval audit trail on customer_profiles.
-- Additive only. All columns nullable, no backfill. Zero-downtime safe.
-- Mirrors therapist_profiles approval columns exactly.
-- approved_by stores an Identity Platform UID (VARCHAR(128)), NOT a uuid.

ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "approved_by"      VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "approved_at"      TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

-- Supports admin queue: WHERE approval_status = 'review' ORDER BY created_at
CREATE INDEX IF NOT EXISTS "customer_profiles_approval_status_created_at_idx"
  ON "customer_profiles" ("approval_status", "created_at");

-- Supports admin list page type+status filter tab combination
CREATE INDEX IF NOT EXISTS "customer_profiles_customer_type_approval_status_idx"
  ON "customer_profiles" ("customer_type", "approval_status");