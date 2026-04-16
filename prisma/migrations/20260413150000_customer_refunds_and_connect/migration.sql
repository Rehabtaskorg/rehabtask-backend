-- Customer Connect account support
-- Additive: new nullable columns on customer_profiles
ALTER TABLE "customer_profiles"
  ADD COLUMN "stripe_account_id" VARCHAR(255),
  ADD COLUMN "stripe_onboarding_complete" BOOLEAN NOT NULL DEFAULT false;

-- Unique index on stripe_account_id (nullable — only enforced for non-null values)
CREATE UNIQUE INDEX "customer_profiles_stripe_account_id_key" ON "customer_profiles" ("stripe_account_id");

-- CreateIndex: lookup by stripe_account_id
CREATE INDEX "customer_profiles_stripe_account_id_idx" ON "customer_profiles" ("stripe_account_id");

-- CustomerRefundStatus enum
CREATE TYPE "CustomerRefundStatus" AS ENUM ('pending_connect', 'transferred', 'refunded_to_card');

-- CustomerRefund table — tracks refunds owed to customers via Connect transfer
-- or fallback card refund. Decoupled from Payment.stripeRefundId which stays
-- for the legacy full-booking-cancel refund path.
CREATE TABLE "customer_refunds" (
    "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "customer_id"              UUID         NOT NULL,
    "payment_id"               UUID         NOT NULL,
    "booking_id"               UUID         NOT NULL,
    "amount"                   DECIMAL(10,2) NOT NULL,
    "status"                   "CustomerRefundStatus" NOT NULL,
    "stripe_transfer_id"       VARCHAR(255),
    "stripe_refund_id"         VARCHAR(255),
    "reason"                   VARCHAR(255),
    "connect_reminder_sent_at" TIMESTAMPTZ(3),
    "fallback_refund_at"       TIMESTAMPTZ(3),
    "transferred_at"           TIMESTAMPTZ(3),
    "expires_at"               TIMESTAMPTZ(3) NOT NULL,
    "created_at"               TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_refunds_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "customer_refunds"
  ADD CONSTRAINT "customer_refunds_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_refunds"
  ADD CONSTRAINT "customer_refunds_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_refunds"
  ADD CONSTRAINT "customer_refunds_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraints
CREATE UNIQUE INDEX "customer_refunds_stripe_transfer_id_key" ON "customer_refunds" ("stripe_transfer_id");
CREATE UNIQUE INDEX "customer_refunds_stripe_refund_id_key" ON "customer_refunds" ("stripe_refund_id");

-- Indexes for queries
CREATE INDEX "customer_refunds_customer_id_status_idx" ON "customer_refunds" ("customer_id", "status");
CREATE INDEX "customer_refunds_status_expires_at_idx" ON "customer_refunds" ("status", "expires_at");
CREATE INDEX "customer_refunds_payment_id_idx" ON "customer_refunds" ("payment_id");
CREATE INDEX "customer_refunds_booking_id_idx" ON "customer_refunds" ("booking_id");