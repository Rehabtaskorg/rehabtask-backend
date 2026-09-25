-- Allow multiple consent signatures per (customer, document_type) so consent
-- history is append-only and auditable, matching ComplianceSignature semantics.
-- Required for re-consent when legal language changes (HIPAA NPP revisions,
-- treatment consent per certification period).
--
-- Safe at any point: this table has no write path in the application today
-- (individual customer consent-signing flow not yet built), so it is empty in
-- every environment. Fixed now, before that flow is built against the old
-- (incorrect) one-signature-per-type constraint.
DROP INDEX IF EXISTS "customer_consent_signatures_customer_id_document_type_key";

CREATE INDEX IF NOT EXISTS "customer_consent_signatures_customer_id_document_type_signed_at_idx"
  ON "customer_consent_signatures"("customer_id", "document_type", "signed_at" DESC);
