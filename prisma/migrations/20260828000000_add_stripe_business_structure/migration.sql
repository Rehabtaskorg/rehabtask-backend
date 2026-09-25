DO $$ BEGIN
  CREATE TYPE "StripeBusinessStructure" AS ENUM (
    'individual',
    'sole_proprietorship',
    'single_member_llc',
    'multi_member_llc',
    'private_corporation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE therapist_profiles
  ADD COLUMN IF NOT EXISTS stripe_business_structure "StripeBusinessStructure";

ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS stripe_business_structure "StripeBusinessStructure";