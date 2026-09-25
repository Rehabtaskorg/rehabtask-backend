ALTER TYPE "SubscriptionPlan" RENAME VALUE 'standard' TO 'pro';
ALTER TYPE "SubscriptionPlan" RENAME VALUE 'premium' TO 'enterprise';
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'unlimited';

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "therapist_limit";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "request_limit";

ALTER TABLE "subscriptions" ADD COLUMN "visit_limit" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "subscriptions" ADD COLUMN "job_posting_limit" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "billing_interval";