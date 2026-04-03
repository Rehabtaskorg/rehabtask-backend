-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "storage_path" TEXT NOT NULL,
    "bucket" VARCHAR(50) NOT NULL DEFAULT 'message-attachments',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_attachments_message_id_idx" ON "message_attachments"("message_id");

-- CreateIndex
CREATE INDEX "message_attachments_conversation_id_created_at_idx" ON "message_attachments"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "direct_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
