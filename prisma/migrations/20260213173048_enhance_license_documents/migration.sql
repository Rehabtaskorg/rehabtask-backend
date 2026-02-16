-- AlterTable
ALTER TABLE "license_documents" ADD COLUMN     "bucket" VARCHAR(50) DEFAULT 'license-documents',
ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "status" VARCHAR(20) DEFAULT 'pending',
ADD COLUMN     "upload_ip" VARCHAR(45),
ADD COLUMN     "user_id" UUID,
ADD COLUMN     "verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "verified_by" UUID;

-- CreateIndex
CREATE INDEX "idx_license_documents_user_active" ON "license_documents"("user_id");

-- CreateIndex
CREATE INDEX "license_documents_status_uploaded_at_idx" ON "license_documents"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "license_documents_therapist_id_status_idx" ON "license_documents"("therapist_id", "status");

-- AddForeignKey
ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
