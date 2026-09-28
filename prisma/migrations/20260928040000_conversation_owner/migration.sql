ALTER TABLE "conversations" ADD COLUMN "user_id" TEXT NOT NULL DEFAULT 'dev-local';
ALTER TABLE "conversations" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "conversations" ADD COLUMN "allowed_course_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "conversations" SET "allowed_course_ids" = ARRAY["course_id"] WHERE "course_id" IS NOT NULL;
UPDATE "conversations" SET "allowed_course_ids" = COALESCE((SELECT array_agg("id") FROM "courses"), ARRAY[]::TEXT[]) WHERE "course_id" IS NULL;
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at");
