CREATE TABLE "processed_webhook_events" (
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "event_type"      VARCHAR(100) NOT NULL,
    "processed_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("stripe_event_id")
);
CREATE INDEX "processed_webhook_events_processed_at_idx" ON "processed_webhook_events"("processed_at");

CREATE UNIQUE INDEX "customer_refunds_session_id_payment_id_key"
    ON "customer_refunds"("session_id", "payment_id")
    WHERE "session_id" IS NOT NULL;

ALTER TABLE "payments" ALTER COLUMN "released_amount" SET DEFAULT 0;
ALTER TABLE "payments" ALTER COLUMN "refunded_amount" SET DEFAULT 0;
UPDATE "payments" SET "released_amount" = 0 WHERE "released_amount" IS NULL;
UPDATE "payments" SET "refunded_amount" = 0 WHERE "refunded_amount" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "released_amount" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "refunded_amount" SET NOT NULL;

ALTER TABLE "payments" ADD COLUMN "idempotency_key" VARCHAR(255);
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");