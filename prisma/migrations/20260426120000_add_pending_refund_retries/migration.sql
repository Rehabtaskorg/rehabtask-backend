-- CreateEnum
CREATE TYPE "PendingRefundRetryStatus" AS ENUM ('pending', 'resolved', 'failed');

-- CreateTable
CREATE TABLE "pending_refund_retries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "status" "PendingRefundRetryStatus" NOT NULL DEFAULT 'pending',
    "error_log" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_refund_retries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_refund_retries_status_created_at_idx" ON "pending_refund_retries"("status", "created_at");

-- CreateIndex
CREATE INDEX "pending_refund_retries_session_id_idx" ON "pending_refund_retries"("session_id");
