-- Attempted Visit support: therapist arrives but patient isn't home.
-- Draws from escrow: a portion goes to the therapist (their attempted-visit rate),
-- the remainder is refunded to the customer via the existing per-session refund path.
--
-- All columns nullable/additive — legacy offers and bookings stay untouched,
-- and the Mark Attempted button stays hidden for any booking without a snapshot.

-- Therapist profile: default attempted-visit rate (live, editable)
ALTER TABLE "therapist_profiles"
  ADD COLUMN "attempted_visit_rate" DECIMAL(10, 2);

-- Offer: snapshot at send time (what this customer is agreeing to)
ALTER TABLE "offers"
  ADD COLUMN "attempted_visit_rate" DECIMAL(10, 2);

-- Booking: immutable snapshot at accept time (the binding rate)
ALTER TABLE "bookings"
  ADD COLUMN "attempted_visit_rate" DECIMAL(10, 2);

-- Session: per-session attempt details
ALTER TABLE "sessions"
  ADD COLUMN "attempted_rate_charged" DECIMAL(10, 2),
  ADD COLUMN "attempted_reason" VARCHAR(500),
  ADD COLUMN "attempted_at" TIMESTAMPTZ(3),
  ADD COLUMN "attempted_by" "MissedByRole";

-- SessionStatus enum: new 'attempted' terminal state
ALTER TYPE "SessionStatus" ADD VALUE 'attempted';