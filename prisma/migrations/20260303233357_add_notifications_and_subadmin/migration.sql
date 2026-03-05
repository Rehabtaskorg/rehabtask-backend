-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'sub_admin';

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN     "assigned_admin_id" UUID,
ADD COLUMN     "title" VARCHAR(255);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deactivated_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "entity_type" VARCHAR(50),
    "entity_id" VARCHAR(255),
    "metadata" JSONB,
    "sent_at" TIMESTAMPTZ(3),
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_admin_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permissions" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sub_admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_configs" (
    "id" UUID NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_type_entity_id_idx" ON "notifications"("user_id", "type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_type_entity_id_idx" ON "notifications"("type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_admin_profiles_user_id_key" ON "sub_admin_profiles"("user_id");

-- CreateIndex
CREATE INDEX "sub_admin_profiles_user_id_idx" ON "sub_admin_profiles"("user_id");

-- CreateIndex
CREATE INDEX "sub_admin_profiles_created_by_admin_id_idx" ON "sub_admin_profiles"("created_by_admin_id");

-- CreateIndex
CREATE INDEX "commission_configs_effective_from_idx" ON "commission_configs"("effective_from");

-- CreateIndex
CREATE INDEX "commission_configs_created_by_admin_id_effective_from_idx" ON "commission_configs"("created_by_admin_id", "effective_from");

-- CreateIndex
CREATE INDEX "disputes_assigned_admin_id_idx" ON "disputes"("assigned_admin_id");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_admin_profiles" ADD CONSTRAINT "sub_admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_admin_profiles" ADD CONSTRAINT "sub_admin_profiles_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_configs" ADD CONSTRAINT "commission_configs_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
