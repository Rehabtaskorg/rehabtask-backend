-- Add cancellation_requested to BookingStatus enum
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'cancellation_requested';

-- Add cancellation fields to bookings table
-- All nullable — safe on a live table, no backfill required
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "cancellation_reason"        TEXT,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at"  TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "pre_cancellation_status"    VARCHAR(50);
