-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'pending_schedule';

-- DropIndex
DROP INDEX "sessions_booking_id_key";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "early_completion_by" VARCHAR(20),
ADD COLUMN     "early_completion_reason" TEXT,
ADD COLUMN     "early_completion_requested" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "session_number" INTEGER,
ALTER COLUMN "scheduled_date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "therapy_requests" ADD COLUMN     "number_of_weeks" INTEGER,
ADD COLUMN     "visits_per_week" INTEGER;

-- CreateIndex
CREATE INDEX "sessions_booking_id_session_number_idx" ON "sessions"("booking_id", "session_number");
