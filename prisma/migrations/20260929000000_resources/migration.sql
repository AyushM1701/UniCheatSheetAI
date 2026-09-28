CREATE TYPE "ResourceType" AS ENUM ('lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other');
CREATE TYPE "ContentFormat" AS ENUM ('typed', 'handwritten', 'mixed', 'scan', 'unknown');

CREATE TABLE "resources" (
  "id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "resource_type" "ResourceType" NOT NULL,
  "title" TEXT NOT NULL,
  "unit" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "content_format" "ContentFormat" NOT NULL DEFAULT 'unknown',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "source_provider" TEXT,
  "source_asset_id" TEXT,
  "academic_document_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "resources" ADD CONSTRAINT "resources_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resources" ADD CONSTRAINT "resources_academic_document_id_fkey" FOREIGN KEY ("academic_document_id") REFERENCES "academic_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "resources_course_id_resource_type_active_idx" ON "resources"("course_id", "resource_type", "active");
CREATE INDEX "resources_source_provider_source_asset_id_idx" ON "resources"("source_provider", "source_asset_id");
CREATE INDEX "resources_academic_document_id_idx" ON "resources"("academic_document_id");

INSERT INTO "resources" ("id", "course_id", "resource_type", "title", "active", "source_provider", "source_asset_id", "academic_document_id")
SELECT 'local:' || d.id, d.course_id,
  CASE WHEN d.type IN ('lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement') THEN d.type::"ResourceType" ELSE 'other'::"ResourceType" END,
  d.title, COALESCE(sf.active, true), sf.provider, sf.remote_file_id, d.id
FROM "academic_documents" d
LEFT JOIN "source_files" sf ON sf.academic_document_id = d.id
ON CONFLICT ("id") DO NOTHING;
