-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'partially_released';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "released_amount" DECIMAL(10,2);
