-- Phase 1: document replacement lineage. supersedes_id points at the document
-- this one replaces, so a replacement chain is reconstructable for audit.
-- Additive only: nullable, no default, no backfill — existing rows are unaffected.

ALTER TABLE "license_documents"
  ADD COLUMN IF NOT EXISTS "supersedes_id" UUID;

-- Self-referencing FK. SET NULL (not CASCADE): if a superseded document is ever
-- hard-deleted, the replacement must survive with its pointer cleared — cascading
-- would delete the newer document, which is the opposite of the intent.
ALTER TABLE "license_documents"
  ADD CONSTRAINT "license_documents_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "license_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index the FK: Postgres does not auto-index foreign keys, and this column is
-- read when walking a document's replacement chain.
CREATE INDEX IF NOT EXISTS "license_documents_supersedes_id_idx"
  ON "license_documents" ("supersedes_id");
