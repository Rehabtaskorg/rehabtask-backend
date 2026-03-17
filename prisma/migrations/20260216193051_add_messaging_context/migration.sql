-- DropIndex
DROP INDEX "messages_recipient_id_read_at_created_at_idx";

-- DropIndex
DROP INDEX "messages_sender_id_created_at_idx";

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "booking_id" UUID,
ADD COLUMN     "offer_id" UUID,
ADD COLUMN     "request_id" UUID;

-- CreateIndex
CREATE INDEX "messages_recipient_id_read_at_idx" ON "messages"("recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "messages_request_id_created_at_idx" ON "messages"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_offer_id_created_at_idx" ON "messages"("offer_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_booking_id_created_at_idx" ON "messages"("booking_id", "created_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "therapy_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
