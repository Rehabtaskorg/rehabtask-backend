-- Visit Type Unification — Phase 1
--
-- Adds FK columns to therapy_requests and bookings so they can reference the
-- curated visit_types catalog directly (instead of storing free-text strings).
-- offers.visit_type_id already exists from migration 20260320061102 — it's
-- repurposed semantically (no schema change on offers).
--
-- Also adds the customer_visible flag to visit_types so therapist-internal
-- codes (Missed Visit, Supervisory, Attempted, Assistant Follow-up) can be
-- hidden from the customer picker.
--
-- All changes are additive and production-safe:
--   - New columns are nullable (or have defaults that preserve existing behavior)
--   - No DROP, no RENAME, no destructive backfills
--   - Legacy string columns (therapy_requests.visit_type, offers.visit_type,
--     bookings.visit_type) remain in place; they're cleaned up in Phase 3
--     after the frontend has been on FK writes for 2+ weeks.
--
--

-- 1. Customer visibility flag on the catalog.
--    Default true preserves existing behavior — existing rows all stay visible
--    until the admin UPDATE below flips the therapist-internal codes.
ALTER TABLE "visit_types" ADD COLUMN "customer_visible" BOOLEAN NOT NULL DEFAULT true;

-- 2. FK column on therapy_requests. Nullable, ON DELETE SET NULL to mirror
--    offers.visit_type_id's existing FK behavior.
ALTER TABLE "therapy_requests" ADD COLUMN "visit_type_id" UUID;
ALTER TABLE "therapy_requests"
    ADD CONSTRAINT "therapy_requests_visit_type_id_fkey"
    FOREIGN KEY ("visit_type_id") REFERENCES "visit_types"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "therapy_requests_visit_type_id_idx" ON "therapy_requests"("visit_type_id");

-- 3. FK column on bookings. Same pattern.
ALTER TABLE "bookings" ADD COLUMN "visit_type_id" UUID;
ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_visit_type_id_fkey"
    FOREIGN KEY ("visit_type_id") REFERENCES "visit_types"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "bookings_visit_type_id_idx" ON "bookings"("visit_type_id");

-- 4. One-time admin backfill: hide therapist-internal codes from customer picker.
--    Safe to run multiple times — idempotent. If the seed hasn't run yet (fresh
--    env), this UPDATE matches zero rows and silently no-ops; the Phase 1 seed
--    wiring will then create rows with customer_visible=true, and a follow-up
--    run of this statement (or the admin UI) can flip them.
UPDATE "visit_types"
SET "customer_visible" = false
WHERE "code" IN ('MV', 'PTSU', 'OTSU', 'PTAV', 'OTAV', 'STAV', 'PTFA', 'OTFA');
