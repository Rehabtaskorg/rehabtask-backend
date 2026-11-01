ALTER TABLE "customer_refunds" ADD COLUMN "stripe_payout_id" VARCHAR(255);
CREATE INDEX "customer_refunds_stripe_payout_id_idx" ON "customer_refunds"("stripe_payout_id");