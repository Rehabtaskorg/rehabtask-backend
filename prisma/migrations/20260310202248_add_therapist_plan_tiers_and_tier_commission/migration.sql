-- CreateEnum
CREATE TYPE "TherapistPlan" AS ENUM ('basic', 'pro', 'elite');

-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'standard';

-- AlterTable
ALTER TABLE "commission_configs" ADD COLUMN     "tier" "TherapistPlan";

-- AlterTable
ALTER TABLE "therapist_profiles" ADD COLUMN     "plan_tier" "TherapistPlan" NOT NULL DEFAULT 'basic';

-- CreateIndex
CREATE INDEX "commission_configs_tier_effective_from_idx" ON "commission_configs"("tier", "effective_from");

-- CreateIndex
CREATE INDEX "therapist_profiles_plan_tier_approval_status_idx" ON "therapist_profiles"("plan_tier", "approval_status");
