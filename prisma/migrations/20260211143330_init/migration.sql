-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer', 'therapist', 'admin');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('individual', 'agency');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('review', 'approved', 'rejected', 'pending');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free', 'premium');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'inactive', 'cancelled', 'past_due');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('created', 'offers_received', 'offers_accepted', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'completed_by_therapist', 'confirmed_by_customer', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('intent_created', 'escrowed', 'released', 'refunded', 'failed');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');

-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL DEFAULT '',
    "role" "UserRole" NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_type" "CustomerType" NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "agency_name" VARCHAR(255),
    "phone" VARCHAR(20) NOT NULL,
    "location" TEXT,
    "stripe_customer_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "therapist_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "years_of_experience" INTEGER,
    "primary_license_type" VARCHAR(100),
    "professional_summary" TEXT,
    "profile_photo_url" TEXT,
    "specialization" TEXT,
    "license_number" VARCHAR(100),
    "license_state" VARCHAR(2),
    "work_area" TEXT,
    "stripe_account_id" VARCHAR(255),
    "stripe_onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "background_check_consent" BOOLEAN DEFAULT false,
    "background_check_signature" VARCHAR(255),
    "background_check_date" TIMESTAMPTZ(3),
    "background_check_status" "BackgroundCheckStatus" DEFAULT 'pending',
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'review',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "onboarding_step" INTEGER NOT NULL DEFAULT 1,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "therapist_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_documents" (
    "id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "document_url" TEXT NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability" (
    "id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "time_blocks" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "stripe_subscription_id" VARCHAR(255),
    "stripe_customer_id" VARCHAR(255) NOT NULL,
    "plan_type" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "therapist_limit" INTEGER NOT NULL,
    "request_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_requests" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "patient_id" UUID,
    "service_type" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "preferred_date" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "therapy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "session_type" VARCHAR(20) NOT NULL,
    "proposed_date" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "patient_id" UUID,
    "therapist_id" UUID NOT NULL,
    "scheduled_date" TIMESTAMPTZ(3) NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "session_type" VARCHAR(20) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "scheduled_date" TIMESTAMPTZ(3) NOT NULL,
    "status" "SessionStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "confirmed_by_customer_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_transfer_id" VARCHAR(255),
    "amount" DECIMAL(10,2) NOT NULL,
    "platform_fee" DECIMAL(10,2) NOT NULL,
    "therapist_payout" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "escrowed_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "patient_id" UUID,
    "content" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_areas" (
    "id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(50) NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "radius_miles" INTEGER NOT NULL DEFAULT 25,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "changes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "data_type" VARCHAR(20) NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_stripe_customer_id_key" ON "customer_profiles"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "customer_profiles_user_id_idx" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_profiles_customer_type_idx" ON "customer_profiles"("customer_type");

-- CreateIndex
CREATE INDEX "customer_profiles_stripe_customer_id_idx" ON "customer_profiles"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_agency_id_idx" ON "patients"("agency_id");

-- CreateIndex
CREATE INDEX "patients_user_id_idx" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_email_idx" ON "patients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_profiles_user_id_key" ON "therapist_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_profiles_license_number_key" ON "therapist_profiles"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_profiles_stripe_account_id_key" ON "therapist_profiles"("stripe_account_id");

-- CreateIndex
CREATE INDEX "therapist_profiles_user_id_idx" ON "therapist_profiles"("user_id");

-- CreateIndex
CREATE INDEX "therapist_profiles_approval_status_created_at_idx" ON "therapist_profiles"("approval_status", "created_at");

-- CreateIndex
CREATE INDEX "therapist_profiles_stripe_account_id_idx" ON "therapist_profiles"("stripe_account_id");

-- CreateIndex
CREATE INDEX "therapist_profiles_license_number_idx" ON "therapist_profiles"("license_number");

-- CreateIndex
CREATE INDEX "therapist_profiles_background_check_status_idx" ON "therapist_profiles"("background_check_status");

-- CreateIndex
CREATE INDEX "license_documents_therapist_id_idx" ON "license_documents"("therapist_id");

-- CreateIndex
CREATE INDEX "availability_therapist_id_idx" ON "availability"("therapist_id");

-- CreateIndex
CREATE INDEX "availability_day_of_week_idx" ON "availability"("day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "availability_therapist_id_day_of_week_key" ON "availability"("therapist_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_customer_id_status_idx" ON "subscriptions"("customer_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_stripe_subscription_id_idx" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "therapy_requests_customer_id_status_created_at_idx" ON "therapy_requests"("customer_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "therapy_requests_patient_id_status_created_at_idx" ON "therapy_requests"("patient_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "therapy_requests_status_created_at_idx" ON "therapy_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "therapy_requests_latitude_longitude_idx" ON "therapy_requests"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "therapy_requests_service_type_status_idx" ON "therapy_requests"("service_type", "status");

-- CreateIndex
CREATE INDEX "offers_request_id_status_idx" ON "offers"("request_id", "status");

-- CreateIndex
CREATE INDEX "offers_therapist_id_status_created_at_idx" ON "offers"("therapist_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "offers_status_expires_at_idx" ON "offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "offers_therapist_id_request_id_idx" ON "offers"("therapist_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_offer_id_key" ON "bookings"("offer_id");

-- CreateIndex
CREATE INDEX "bookings_customer_id_status_scheduled_date_idx" ON "bookings"("customer_id", "status", "scheduled_date");

-- CreateIndex
CREATE INDEX "bookings_patient_id_status_scheduled_date_idx" ON "bookings"("patient_id", "status", "scheduled_date");

-- CreateIndex
CREATE INDEX "bookings_therapist_id_status_scheduled_date_idx" ON "bookings"("therapist_id", "status", "scheduled_date");

-- CreateIndex
CREATE INDEX "bookings_status_scheduled_date_idx" ON "bookings"("status", "scheduled_date");

-- CreateIndex
CREATE INDEX "bookings_offer_id_idx" ON "bookings"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_booking_id_key" ON "sessions"("booking_id");

-- CreateIndex
CREATE INDEX "sessions_booking_id_idx" ON "sessions"("booking_id");

-- CreateIndex
CREATE INDEX "sessions_status_completed_at_idx" ON "sessions"("status", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_key" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_transfer_id_key" ON "payments"("stripe_transfer_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_stripe_payment_intent_id_idx" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "payments_customer_id_created_at_idx" ON "payments"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_therapist_id_status_released_at_idx" ON "payments"("therapist_id", "status", "released_at");

-- CreateIndex
CREATE INDEX "payments_status_escrowed_at_idx" ON "payments"("status", "escrowed_at");

-- CreateIndex
CREATE INDEX "messages_recipient_id_read_at_created_at_idx" ON "messages"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_recipient_id_created_at_idx" ON "messages"("sender_id", "recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_patient_id_created_at_idx" ON "messages"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "work_areas_therapist_id_idx" ON "work_areas"("therapist_id");

-- CreateIndex
CREATE INDEX "work_areas_latitude_longitude_idx" ON "work_areas"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "system_config_key_idx" ON "system_config"("key");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_profiles" ADD CONSTRAINT "therapist_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_documents" ADD CONSTRAINT "license_documents_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability" ADD CONSTRAINT "availability_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_requests" ADD CONSTRAINT "therapy_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_requests" ADD CONSTRAINT "therapy_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "therapy_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_areas" ADD CONSTRAINT "work_areas_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
