-- AlterTable
ALTER TABLE "customer_profiles" ALTER COLUMN "approval_status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "customer_refunds" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "session_payouts" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "session_payouts_stripe_transfer_id_idx" ON "session_payouts"("stripe_transfer_id");
