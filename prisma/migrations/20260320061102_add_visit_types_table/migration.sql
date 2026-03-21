-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "visit_type_id" UUID;

-- CreateTable
CREATE TABLE "visit_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "discipline" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visit_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_types_code_key" ON "visit_types"("code");

-- CreateIndex
CREATE INDEX "visit_types_discipline_is_active_idx" ON "visit_types"("discipline", "is_active");

-- CreateIndex
CREATE INDEX "visit_types_code_idx" ON "visit_types"("code");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_visit_type_id_fkey" FOREIGN KEY ("visit_type_id") REFERENCES "visit_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
