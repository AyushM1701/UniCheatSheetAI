ALTER TABLE "academic_documents"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pending_checksum" TEXT,
  ADD COLUMN "last_successful_at" TIMESTAMP(3),
  ADD COLUMN "last_failure_at" TIMESTAMP(3),
  ADD COLUMN "last_failure_reason" TEXT;
UPDATE "academic_documents" SET "revision" = 1, "last_successful_at" = "updated_at" WHERE "processing_status" = 'indexed';
