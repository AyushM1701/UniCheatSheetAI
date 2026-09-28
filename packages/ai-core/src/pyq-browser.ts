import { db, Prisma } from '@ucs/database';
import type { RetrievalHit } from '@ucs/retrieval';

type QuestionChunk = Prisma.DocumentChunkGetPayload<{ include: { document: true } }>;
function toHit(chunk: QuestionChunk): RetrievalHit {
  const metadata = chunk.metadata && typeof chunk.metadata === 'object' && !Array.isArray(chunk.metadata) ? chunk.metadata as Record<string, unknown> : {};
  const document = chunk.document;
  return {
    chunkId: chunk.id, documentId: document.id, courseId: chunk.courseId,
    document: document.title, documentTitle: document.title, title: document.title,
    type: document.type, source: document.source,
    page: chunk.page, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd,
    content: chunk.content, sourceUrl: document.sourceUrl,
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
    include: { document: true }
  });
  return chunk ? toHit(chunk) : null;
}

/** Browse real indexed question chunks when a student requests PYQs without a topic. */
export async function browsePyqQuestions(courseIds: string[], semester?: number, limit = 5): Promise<RetrievalHit[]> {
  if (!courseIds.length) return [];
  const chunks = await db.documentChunk.findMany({
    where: {
      courseId: { in: courseIds },
      document: {
        type: 'pyq', visibility: 'global', processingStatus: 'indexed',
        OR: [{ sourceFile: null }, { sourceFile: { active: true } }],
        ...(semester ? { course: { semester } } : {})
      }
    },
    include: { document: true },
    orderBy: [{ document: { updatedAt: 'desc' } }, { chunkIndex: 'asc' }],
    take: Math.max(limit * 8, 32)
  });
  const questions = chunks.filter((chunk) => /\. Question \d+:/i.test(chunk.content));
  const selected = (questions.length ? questions : chunks).slice(0, limit);
  return selected.map(toHit);
}
