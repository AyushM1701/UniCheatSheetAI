import 'dotenv/config';
import { db } from '@ucs/database';
import { examMetadata, examQuestionFields } from '../packages/ingestion/src/exam-metadata.js';

let created = 0;
try {
  const papers = await db.academicDocument.findMany({ where: { type: 'pyq', processingStatus: 'indexed', visibility: 'global' }, select: { id: true, courseId: true, title: true, chunks: { select: { id: true, content: true, pageStart: true, metadata: true } } } });
  for (const paper of papers) {
    const metadata = examMetadata(paper.title);
    for (const chunk of paper.chunks) {
      const review = (chunk.metadata as { needsReview?: boolean } | null)?.needsReview === true;
      const existing = await db.examQuestion.findUnique({ where: { chunkId: chunk.id }, select: { id: true } });
      const data = { documentId: paper.id, courseId: paper.courseId, text: chunk.content, page: chunk.pageStart, needsReview: review, ...metadata, ...examQuestionFields(chunk.content) };
      if (existing) await db.examQuestion.update({ where: { chunkId: chunk.id }, data });
      else { await db.examQuestion.create({ data: { chunkId: chunk.id, ...data } }); created++; }
    }
  }
  console.log(JSON.stringify({ papers: papers.length, questionsCreated: created }));
} finally { await db.$disconnect(); }
