-- Migration: agency_individual_onboarding_schema
-- Adds Agency and Individual Customer onboarding fields.
-- All changes are additive — zero-downtime safe. No existing columns dropped or renamed.

-- ─── 1. CustomerProfile — new onboarding + agency + individual columns ────────

-- Agency-specific
ALTER TABLE "customer_profiles" ADD COLUMN "dba_name" VARCHAR(255);
ALTER TABLE "customer_profiles" ADD COLUMN "ein" VARCHAR(20);
ALTER TABLE "customer_profiles" ADD COLUMN "billing_email" VARCHAR(255);

-- Shared address (agency business address / individual home address)
ALTER TABLE "customer_profiles" ADD COLUMN "address_line_1" VARCHAR(255);
ALTER TABLE "customer_profiles" ADD COLUMN "address_line_2" VARCHAR(255);
ALTER TABLE "customer_profiles" ADD COLUMN "city" VARCHAR(100);
ALTER TABLE "customer_profiles" ADD COLUMN "state" VARCHAR(50);
ALTER TABLE "customer_profiles" ADD COLUMN "zip_code" VARCHAR(10);

-- Individual customer-specific (PHI — never send to analytics)
ALTER TABLE "customer_profiles" ADD COLUMN "date_of_birth" DATE;
ALTER TABLE "customer_profiles" ADD COLUMN "primary_diagnosis" VARCHAR(255);
ALTER TABLE "customer_profiles" ADD COLUMN "referring_provider_name" VARCHAR(255);

-- Onboarding tracking (shared by agency and individual flows)
ALTER TABLE "customer_profiles" ADD COLUMN "onboarding_step" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "customer_profiles" ADD COLUMN "onboarding_complete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'review';

-- Indexes on columns used in admin dashboard WHERE clauses
CREATE INDEX "customer_profiles_approval_status_idx" ON "customer_profiles"("approval_status");
CREATE INDEX "customer_profiles_onboarding_complete_idx" ON "customer_profiles"("onboarding_complete");

-- ─── 2. LicenseDocument — make therapistId nullable, add agencyId + customerId ─

ALTER TABLE "license_documents" ALTER COLUMN "therapist_id" DROP NOT NULL;

ALTER TABLE "license_documents" ADD COLUMN "agency_id" UUID;
ALTER TABLE "license_documents" ADD COLUMN "customer_id" UUID;

-- Check constraint: exactly one owner column must be non-null
ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_owner_check"
  CHECK (
    (CASE WHEN "therapist_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "agency_id"    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "customer_id"  IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

-- Foreign keys for the two new owner columns
ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for the new owner columns
CREATE INDEX "license_documents_agency_id_idx" ON "license_documents"("agency_id");
CREATE INDEX "license_documents_customer_id_idx" ON "license_documents"("customer_id");

-- ─── 3. ComplianceSignature — make therapistId nullable, add agencyId ─────────

ALTER TABLE "compliance_signatures" ALTER COLUMN "therapist_id" DROP NOT NULL;

ALTER TABLE "compliance_signatures" ADD COLUMN "agency_id" UUID;

-- Drop the old therapist-only unique constraint (can't unique-index a nullable column the same way)
DROP INDEX "compliance_signatures_therapist_id_document_type_key";

-- Partial unique indexes — one per owner type, each covering only rows where that owner is set
CREATE UNIQUE INDEX "compliance_signatures_therapist_document_type_key"
  ON "compliance_signatures"("therapist_id", "document_type")
  WHERE "therapist_id" IS NOT NULL;

CREATE UNIQUE INDEX "compliance_signatures_agency_document_type_key"
  ON "compliance_signatures"("agency_id", "document_type")
  WHERE "agency_id" IS NOT NULL;

-- Check constraint: exactly one of therapistId / agencyId must be non-null
ALTER TABLE "compliance_signatures" ADD CONSTRAINT "compliance_signatures_owner_check"
  CHECK (
    (CASE WHEN "therapist_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "agency_id"    IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

-- Foreign key for agencyId
ALTER TABLE "compliance_signatures" ADD CONSTRAINT "compliance_signatures_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for agencyId
CREATE INDEX "compliance_signatures_agency_id_idx" ON "compliance_signatures"("agency_id");

-- ─── 4. CustomerConsentSignature — new table for individual customer consent ───

CREATE TABLE "customer_consent_signatures" (
    "id"                           UUID        NOT NULL,
    "customer_id"                  UUID        NOT NULL,
    "document_type"                VARCHAR(50) NOT NULL,
    "signature"                    VARCHAR(255) NOT NULL,
    "signed_text"                  TEXT        NOT NULL,
    "representative_name"          VARCHAR(255),
    "representative_relationship"  VARCHAR(100),
    "representative_authority"     VARCHAR(100),
    "signed_at"                    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consent_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_consent_signatures_customer_id_document_type_key"
  ON "customer_consent_signatures"("customer_id", "document_type");

CREATE INDEX "customer_consent_signatures_customer_id_idx"
  ON "customer_consent_signatures"("customer_id");

ALTER TABLE "customer_consent_signatures" ADD CONSTRAINT "customer_consent_signatures_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;