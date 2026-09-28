import { db, Prisma } from '@ucs/database';
import { getEmbeddingProvider } from '@ucs/providers';
import type { RetrieveRequest } from '@ucs/shared';

export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  courseId: string;
  document: string;
  documentTitle: string;
  title: string;
  type: string;
  source: string;
  page: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  sourceUrl: string | null;
  similarity: number;
  semanticScore: number;
  score: number;
}

export async function retrieve(input: RetrieveRequest): Promise<RetrievalHit[]> {
  const provider = getEmbeddingProvider();
  const [vector] = await provider.embed([input.query]);
  if (!vector || vector.length !== 384) throw new Error('Query embedding must have 384 dimensions');
  const literal = `[${vector.join(',')}]`;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`d.visibility = 'global'`,
    Prisma.sql`d.processing_status = 'indexed'`,
    Prisma.sql`(sf.id IS NULL OR sf.active = true)`,
    Prisma.sql`d.metadata->>'indexingKey' LIKE ${provider.id + ':%'}`,
    Prisma.sql`c.embedding IS NOT NULL`
  ];
  if (input.courseId) conditions.push(Prisma.sql`c.course_id = ${input.courseId}`);
  if (input.allowedCourseIds) {
    if (input.allowedCourseIds.length === 0) return [];
    conditions.push(Prisma.sql`c.course_id IN (${Prisma.join(input.allowedCourseIds)})`);
  }
  if (input.source) conditions.push(Prisma.sql`d.source = ${input.source}`);
  if (input.semester) conditions.push(Prisma.sql`course.semester = ${input.semester}`);
  if (input.type) conditions.push(Prisma.sql`d.type = ${input.type}`);
  if (input.resourceTypes) conditions.push(Prisma.sql`d.type IN (${Prisma.join(input.resourceTypes)})`);
  const where = Prisma.join(conditions, ' AND ');
  const lexical = Prisma.sql`to_tsvector('english', c.content) @@ plainto_tsquery('english', ${input.query})`;
  const rows = await db.$queryRaw<RetrievalHit[]>`
    SELECT c.id AS "chunkId", d.id AS "documentId", c.course_id AS "courseId",
      d.title AS document, d.title AS "documentTitle", d.title, d.type, d.source,
      c.page, c.page_start AS "pageStart", c.page_end AS "pageEnd", c.content,
      d.source_url AS "sourceUrl",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS similarity,
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS "semanticScore",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS score
    FROM document_chunks c
    JOIN academic_documents d ON d.id = c.document_id
    LEFT JOIN source_files sf ON sf.academic_document_id = d.id
    JOIN courses course ON course.id = c.course_id
    WHERE ${where}
    ORDER BY CASE WHEN ${lexical} THEN 0 ELSE 1 END,
      c.embedding <=> ${literal}::vector
    LIMIT ${input.limit}`;
  const threshold = Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.30);
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('RETRIEVAL_MIN_SCORE must be between -1 and 1');
  const matching = await db.$queryRaw<Array<{ id: string }>>`
    SELECT c.id FROM document_chunks c JOIN academic_documents d ON d.id = c.document_id
    LEFT JOIN source_files sf ON sf.academic_document_id = d.id
    JOIN courses course ON course.id = c.course_id
    WHERE ${where} AND ${lexical} LIMIT ${input.limit}`;
  const lexicalIds = new Set(matching.map((item) => item.id));
  return rows.filter((row) => row.similarity >= threshold || lexicalIds.has(row.chunkId));
}
