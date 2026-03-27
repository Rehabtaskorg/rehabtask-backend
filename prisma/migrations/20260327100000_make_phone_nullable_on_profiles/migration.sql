-- AlterTable: make phone nullable on customer_profiles
ALTER TABLE "customer_profiles" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable: make phone nullable on therapist_profiles
ALTER TABLE "therapist_profiles" ALTER COLUMN "phone" DROP NOT NULL;
