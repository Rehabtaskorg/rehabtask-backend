-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "patient_id" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "patient_id" UUID;

-- AlterTable
ALTER TABLE "therapy_requests" ADD COLUMN     "patient_id" UUID;

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_agency_id_idx" ON "patients"("agency_id");

-- CreateIndex
CREATE INDEX "patients_user_id_idx" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_email_idx" ON "patients"("email");

-- CreateIndex
CREATE INDEX "bookings_patient_id_status_scheduled_date_idx" ON "bookings"("patient_id", "status", "scheduled_date");

-- CreateIndex
CREATE INDEX "customer_profiles_customer_type_idx" ON "customer_profiles"("customer_type");

-- CreateIndex
CREATE INDEX "messages_patient_id_created_at_idx" ON "messages"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "therapy_requests_patient_id_status_created_at_idx" ON "therapy_requests"("patient_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_requests" ADD CONSTRAINT "therapy_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
