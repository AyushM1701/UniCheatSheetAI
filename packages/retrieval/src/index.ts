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
  lexicalMatch: boolean;
  extractionMethod: string;
  needsReview: boolean;
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
  const select = Prisma.sql`
    SELECT c.id AS "chunkId", d.id AS "documentId", c.course_id AS "courseId",
      d.title AS document, d.title AS "documentTitle", d.title, d.type, d.source,
      c.page, c.page_start AS "pageStart", c.page_end AS "pageEnd", c.content,
      d.source_url AS "sourceUrl", COALESCE(c.metadata->>'extractionMethod', 'native') AS "extractionMethod",
      COALESCE((c.metadata->>'needsReview')::boolean, false) AS "needsReview",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS similarity,
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS "semanticScore",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS score
    FROM document_chunks c
    JOIN academic_documents d ON d.id = c.document_id
    LEFT JOIN source_files sf ON sf.academic_document_id = d.id
    JOIN courses course ON course.id = c.course_id
    WHERE ${where}`;
  const candidateLimit = Math.max(input.limit * 4, 24);
  type RetrievalRow = Omit<RetrievalHit, 'lexicalMatch'>;
  const [semanticRows, lexicalRows] = await Promise.all([
    db.$queryRaw<RetrievalRow[]>(Prisma.sql`${select} ORDER BY c.embedding <=> ${literal}::vector LIMIT ${candidateLimit}`),
    db.$queryRaw<RetrievalRow[]>(Prisma.sql`${select} AND ${lexical} ORDER BY ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', ${input.query})) DESC, c.embedding <=> ${literal}::vector LIMIT ${candidateLimit}`)
  ]);
  const threshold = Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.30);
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('RETRIEVAL_MIN_SCORE must be between -1 and 1');
  const lexicalOrder = new Map(lexicalRows.map((row, index) => [row.chunkId, index]));
  const unique = new Map([...semanticRows, ...lexicalRows].map((row) => [row.chunkId, row]));
  return [...unique.values()]
    .filter((row) => row.similarity >= threshold || lexicalOrder.has(row.chunkId))
    .sort((left, right) => {
      const leftRank = lexicalOrder.get(left.chunkId);
      const rightRank = lexicalOrder.get(right.chunkId);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return right.similarity - left.similarity;
    })
    .slice(0, input.limit)
    .map((row) => ({ ...row, lexicalMatch: lexicalOrder.has(row.chunkId) }));
}
