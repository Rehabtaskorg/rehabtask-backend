-- Visit Plan Override: additive-only migration.
-- Adds nullable columns to offers and bookings so therapists can propose
-- a different treatment plan on their offer, and the accepted plan is
-- snapshotted on the booking (copy-on-accept).
--
-- NULL in these columns means "no override" — consumers fall back through
-- offer → request via the resolveVisitPlan helper in src/utils/visitPlan.js.
-- Legacy rows remain NULL and keep working identically to pre-migration.
--

-- Offer: therapist's proposed plan (null = accept customer's plan as-is)
ALTER TABLE "offers" ADD COLUMN "visit_type" VARCHAR(100);
ALTER TABLE "offers" ADD COLUMN "visits_per_week" INTEGER;
ALTER TABLE "offers" ADD COLUMN "number_of_weeks" INTEGER;

-- Booking: authoritative plan snapshot copied on acceptance
ALTER TABLE "bookings" ADD COLUMN "visit_type" VARCHAR(100);
ALTER TABLE "bookings" ADD COLUMN "visits_per_week" INTEGER;
ALTER TABLE "bookings" ADD COLUMN "number_of_weeks" INTEGER;