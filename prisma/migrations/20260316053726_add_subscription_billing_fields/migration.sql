-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'annual');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'trialing';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'grace_period';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billing_interval" "BillingInterval",
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "grace_period_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "stripe_price_id" VARCHAR(255),
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(3),
ALTER COLUMN "stripe_customer_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "subscriptions_status_trial_ends_at_idx" ON "subscriptions"("status", "trial_ends_at");

-- CreateIndex
CREATE INDEX "subscriptions_status_grace_period_ends_at_idx" ON "subscriptions"("status", "grace_period_ends_at");
