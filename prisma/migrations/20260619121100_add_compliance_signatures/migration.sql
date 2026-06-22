-- CreateTable
CREATE TABLE "compliance_signatures" (
    "id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "signature" VARCHAR(255) NOT NULL,
    "signed_text" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_signatures_therapist_id_idx" ON "compliance_signatures"("therapist_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_signatures_therapist_id_document_type_key" ON "compliance_signatures"("therapist_id", "document_type");

-- AddForeignKey
ALTER TABLE "compliance_signatures" ADD CONSTRAINT "compliance_signatures_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
