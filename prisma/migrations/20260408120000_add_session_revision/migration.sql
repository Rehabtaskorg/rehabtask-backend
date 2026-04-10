-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'in_revision';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "revision_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision_due_by" TIMESTAMPTZ(3),
ADD COLUMN     "revision_last_submitted_at" TIMESTAMPTZ(3),
ADD COLUMN     "revision_reason" TEXT,
ADD COLUMN     "revision_requested_at" TIMESTAMPTZ(3);
