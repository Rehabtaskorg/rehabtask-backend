-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('PUBLIC', 'DIRECT');

-- AlterTable: add new columns (nullable/defaulted — zero downtime, no table rewrite)
ALTER TABLE "therapy_requests"
  ADD COLUMN "request_type" "RequestType" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "target_therapist_id" UUID;

-- AddForeignKey
ALTER TABLE "therapy_requests"
  ADD CONSTRAINT "therapy_requests_target_therapist_id_fkey"
  FOREIGN KEY ("target_therapist_id")
  REFERENCES "therapist_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "therapy_requests_target_therapist_id_status_idx" ON "therapy_requests"("target_therapist_id", "status");
CREATE INDEX "therapy_requests_customer_id_request_type_status_idx" ON "therapy_requests"("customer_id", "request_type", "status");