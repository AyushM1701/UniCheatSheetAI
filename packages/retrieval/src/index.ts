import { db, Prisma } from '@ucs/database';
import { getEmbeddingProvider } from '@ucs/providers';
import type { RetrieveRequest } from '@ucs/shared';

export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  resourceId: string | null;
  courseId: string;
  courseName: string;
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
  unit: string | null;
  contentFormat: string | null;
  similarity: number;
  semanticScore: number;
  score: number;
  lexicalMatch: boolean;
  extractionMethod: string;
  needsReview: boolean;
}

export async function retrieve(input: RetrieveRequest): Promise<RetrievalHit[]> {
  if (!input.allowedCourseIds?.length) return [];
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
  if (input.documentId) conditions.push(Prisma.sql`d.id = ${input.documentId}`);
  if (input.resourceId) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM resources selected WHERE selected.id = ${input.resourceId} AND selected.academic_document_id = d.id AND selected.course_id = c.course_id AND selected.active = true)`);
  conditions.push(Prisma.sql`c.course_id IN (${Prisma.join(input.allowedCourseIds)})`);
  if (input.source) conditions.push(Prisma.sql`d.source = ${input.source}`);
  if (input.semester) conditions.push(Prisma.sql`course.semester = ${input.semester}`);
  if (input.type) conditions.push(Prisma.sql`d.type = ${input.type}`);
  if (input.resourceTypes) conditions.push(Prisma.sql`d.type IN (${Prisma.join(input.resourceTypes)})`);
  const where = Prisma.join(conditions, ' AND ');
  const lexical = Prisma.sql`to_tsvector('english', c.content) @@ plainto_tsquery('english', ${input.query})`;
  const select = Prisma.sql`
    SELECT c.id AS "chunkId", d.id AS "documentId", r.id AS "resourceId", c.course_id AS "courseId", course.name AS "courseName",
      d.title AS document, d.title AS "documentTitle", d.title, d.type, d.source,
      c.page, c.page_start AS "pageStart", c.page_end AS "pageEnd", c.content, r.unit, r.content_format::text AS "contentFormat",
      d.source_url AS "sourceUrl", COALESCE(c.metadata->>'extractionMethod', 'native') AS "extractionMethod",
      COALESCE((c.metadata->>'needsReview')::boolean, false) AS "needsReview",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS similarity,
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS "semanticScore",
      (1 - (c.embedding <=> ${literal}::vector))::float8 AS score
    FROM document_chunks c
    JOIN academic_documents d ON d.id = c.document_id
    LEFT JOIN source_files sf ON sf.academic_document_id = d.id
    JOIN courses course ON course.id = c.course_id
    LEFT JOIN LATERAL (SELECT resource.id, resource.unit, resource.content_format FROM resources resource WHERE resource.academic_document_id = d.id AND resource.course_id = c.course_id AND resource.active = true ORDER BY CASE WHEN resource.id LIKE 'local:%' THEN 1 ELSE 0 END, resource.id LIMIT 1) r ON true
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
  const semanticOrder = new Map(semanticRows.map((row, index) => [row.chunkId, index]));
  const unique = new Map([...semanticRows, ...lexicalRows].map((row) => [row.chunkId, row]));
  const fused = [...unique.values()]
    .filter((row) => row.similarity >= threshold || lexicalOrder.has(row.chunkId))
    .sort((left, right) => {
      const rank = (row: RetrievalRow) => 1 / (60 + 1 + (semanticOrder.get(row.chunkId) ?? candidateLimit))
        + (lexicalOrder.has(row.chunkId) ? 1.5 / (60 + 1 + lexicalOrder.get(row.chunkId)!) : 0);
      return rank(right) - rank(left) || right.similarity - left.similarity;
    });
  const selected: RetrievalRow[] = [];
  const byDocument = new Map<string, number>();
  // Limit one document from dominating a short context window while still allowing follow-up detail.
  for (const row of fused) {
    const count = byDocument.get(row.documentId) ?? 0;
    if (count >= 2 && fused.some((candidate) => candidate.documentId !== row.documentId && !selected.some((item) => item.documentId === candidate.documentId))) continue;
    selected.push(row);
    byDocument.set(row.documentId, count + 1);
    if (selected.length >= input.limit) break;
  }
  if (selected.length < input.limit) for (const row of fused) {
    if (!selected.some((item) => item.chunkId === row.chunkId)) selected.push(row);
    if (selected.length >= input.limit) break;
  }
  return selected.map((row) => ({ ...row, lexicalMatch: lexicalOrder.has(row.chunkId) }));
}
