-- Incomplete Visits — Per-Session Payouts & Series Finalization
--
-- Adds the SessionPayout audit trail model so each confirmed session
-- gets its own Stripe transfer record. Adds refund tracking columns
-- to Payment for the finalization auto-refund flow. Adds "finalized"
-- as a terminal BookingStatus for abandoned series.
--
-- All changes are additive. No DROP, no RENAME, no backfill.
-- Existing payments with the old all-or-nothing stripeTransferId
-- continue to work — they just won't have SessionPayout rows.
--
--

-- 1. Add "finalized" to BookingStatus enum
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'finalized';

-- 2. Add refund tracking columns to payments (nullable, additive)
ALTER TABLE "payments" ADD COLUMN "stripe_refund_id" VARCHAR(255);
ALTER TABLE "payments" ADD COLUMN "refunded_amount" DECIMAL(10, 2);

-- Unique index on stripe_refund_id (matches the Prisma @unique annotation)
CREATE UNIQUE INDEX "payments_stripe_refund_id_key" ON "payments"("stripe_refund_id");

-- 3. Create session_payouts table — one row per confirmed session payout
CREATE TABLE "session_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "stripe_transfer_id" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(10, 2) NOT NULL,
    "platform_fee" DECIMAL(10, 2) NOT NULL,
    "therapist_payout" DECIMAL(10, 2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_payouts_pkey" PRIMARY KEY ("id")
);

-- One payout per session — enforced at DB level to prevent double-pay
CREATE UNIQUE INDEX "session_payouts_session_id_key" ON "session_payouts"("session_id");

-- Lookup by payment (for aggregating released amounts)
CREATE INDEX "session_payouts_payment_id_idx" ON "session_payouts"("payment_id");

-- Lookup by Stripe transfer (for reconciliation)
CREATE UNIQUE INDEX "session_payouts_stripe_transfer_id_key" ON "session_payouts"("stripe_transfer_id");

-- Foreign keys
ALTER TABLE "session_payouts"
    ADD CONSTRAINT "session_payouts_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_payouts"
    ADD CONSTRAINT "session_payouts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;