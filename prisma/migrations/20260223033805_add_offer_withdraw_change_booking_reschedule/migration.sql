-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'reschedule_requested';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfferStatus" ADD VALUE 'withdrawn';
ALTER TYPE "OfferStatus" ADD VALUE 'change_requested';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "proposed_new_date" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "change_request_note" TEXT,
ADD COLUMN     "withdrawn_at" TIMESTAMPTZ(3);
