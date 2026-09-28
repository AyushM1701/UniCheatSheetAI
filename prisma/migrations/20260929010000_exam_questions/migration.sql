CREATE TABLE "exam_questions" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "chunk_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "question_number" TEXT,
  "subpart" TEXT,
  "marks" INTEGER,
  "exam_type" TEXT,
  "year" INTEGER,
  "session" TEXT,
  "program" TEXT,
  "course_code" TEXT,
  "topic_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "text" TEXT NOT NULL,
  "page" INTEGER,
  "needs_review" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exam_questions_chunk_id_key" ON "exam_questions"("chunk_id");
CREATE INDEX "exam_questions_course_id_year_exam_type_idx" ON "exam_questions"("course_id", "year", "exam_type");
CREATE INDEX "exam_questions_course_id_question_number_idx" ON "exam_questions"("course_id", "question_number");
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "academic_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
