import { db, Prisma } from '@ucs/database';
import type { RetrievalHit } from '@ucs/retrieval';

type QuestionChunk = Prisma.DocumentChunkGetPayload<{ include: { document: { include: { resources: true; course: true } } } }>;
function toHit(chunk: QuestionChunk): RetrievalHit {
  const metadata = chunk.metadata && typeof chunk.metadata === 'object' && !Array.isArray(chunk.metadata) ? chunk.metadata as Record<string, unknown> : {};
  const document = chunk.document;
  const resource = document.resources.filter((item) => item.active && item.courseId === chunk.courseId).sort((a, b) => Number(a.id.startsWith('local:')) - Number(b.id.startsWith('local:')))[0];
  return {
    chunkId: chunk.id, documentId: document.id, resourceId: resource?.id ?? null, courseId: chunk.courseId, courseName: document.course.name,
    document: document.title, documentTitle: document.title, title: document.title,
    type: document.type, source: document.source,
    page: chunk.page, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd,
    content: chunk.content, sourceUrl: document.sourceUrl, unit: resource?.unit ?? null, contentFormat: resource?.contentFormat ?? null,
    similarity: 1, semanticScore: 1, score: 1, lexicalMatch: false,
    extractionMethod: typeof metadata.extractionMethod === 'string' ? metadata.extractionMethod : 'native',
    needsReview: metadata.needsReview === true
  };
}

export async function loadCitedPyqQuestion(chunkId: string, courseIds: string[]): Promise<RetrievalHit | null> {
  const chunk = await db.documentChunk.findFirst({
    where: {
      id: chunkId, courseId: { in: courseIds },
      document: { type: 'pyq', visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] }
    },
    include: { document: { include: { resources: true, course: true } } }
  });
  return chunk ? toHit(chunk) : null;
}

/** Browse actual indexed exam questions, retaining legacy chunks only for papers not yet backfilled. */
export async function browsePyqQuestions(courseIds: string[], semester?: number, limit = 5, documentId?: string): Promise<RetrievalHit[]> {
  if (!courseIds.length) return [];
  const document: Prisma.AcademicDocumentWhereInput = {
    type: 'pyq', visibility: 'global', processingStatus: 'indexed',
    OR: [{ sourceFile: null }, { sourceFile: { active: true } }],
    ...(semester ? { course: { semester } } : {})
  };
  const questions = await db.examQuestion.findMany({
    where: { courseId: { in: courseIds }, ...(documentId ? { documentId } : {}), document },
    include: { chunk: { include: { document: { include: { resources: true, course: true } } } } },
    orderBy: [{ year: 'desc' }, { documentId: 'asc' }, { page: 'asc' }, { questionNumber: 'asc' }],
    take: limit
  });
  if (questions.length >= limit) return questions.map((question) => toHit(question.chunk));
  const chunks = await db.documentChunk.findMany({
    where: {
      courseId: { in: courseIds }, ...(documentId ? { documentId } : {}),
      examQuestion: { is: null }, document
    },
    include: { document: { include: { resources: true, course: true } } },
    orderBy: [{ document: { updatedAt: 'desc' } }, { chunkIndex: 'asc' }],
    take: Math.max(limit * 8, 32)
  });
  const legacyQuestions = chunks.filter((chunk) => /\. Question \d+:/i.test(chunk.content));
  return [...questions.map((question) => toHit(question.chunk)), ...legacyQuestions.slice(0, limit - questions.length).map(toHit)];
}
