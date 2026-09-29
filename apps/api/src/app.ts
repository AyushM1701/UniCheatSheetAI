import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError, z } from 'zod';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, Prisma } from '@ucs/database';
import { retrieve } from '@ucs/retrieval';
import { retrieveSchema } from '@ucs/shared';
import { chatSchema } from '@ucs/shared';
import { chatService, ForbiddenCourseError, InvalidChatScopeError, UnknownConversationError } from '@ucs/ai-core';
import { createAccessContextProvider, InvalidAccessTokenError, type AccessContextProvider } from './access-context.js';

function providerFailure(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The AI model timed out. Please try again.';
  if (/^Gemini returned (429|503):/.test(error.message)) return 'The AI model is temporarily busy. Please try again shortly.';
  return null;
}

export function buildApp(contextProvider: AccessContextProvider = createAccessContextProvider()) {
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const configuredAccountSecret = process.env.AI_ACCOUNT_KEY_SECRET;
  if (process.env.ACCESS_CONTEXT_PROVIDER === 'jwt' && (!configuredAccountSecret || configuredAccountSecret.length < 32)) throw new Error('AI_ACCOUNT_KEY_SECRET must contain at least 32 characters in JWT mode');
  const accountSalt = configuredAccountSecret ?? randomBytes(32);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 128 * 1024 });
  const rate = new Map<string, { started: number; count: number }>();
  const active = new Map<string, number>();
  const limitPerMinute = Number(process.env.AI_REQUESTS_PER_MINUTE ?? 30);
  const maxConcurrent = Number(process.env.AI_MAX_CONCURRENT_CHATS ?? 2);
  if (!Number.isInteger(limitPerMinute) || limitPerMinute < 1 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('AI request and concurrency limits must be positive integers');
  const claim = (userId: string) => {
    const now = Date.now();
    for (const [id, record] of rate) if (now - record.started >= 60000) rate.delete(id);
    const record = rate.get(userId) ?? { started: now, count: 0 };
    if (record.count >= limitPerMinute || (active.get(userId) ?? 0) >= maxConcurrent) throw new TooManyAiRequestsError();
    record.count++;
    rate.set(userId, record);
    active.set(userId, (active.get(userId) ?? 0) + 1);
    return () => { const left = (active.get(userId) ?? 1) - 1; if (left) active.set(userId, left); else active.delete(userId); };
  };
  const hideDirectLinks = process.env.ACCESS_CONTEXT_PROVIDER === 'jwt';
  const safeCitation = <T extends { sourceUrl: string | null }>(citation: T): T => hideDirectLinks ? { ...citation, sourceUrl: null } : citation;
  const allowedOrigins = (process.env.AI_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error(`Invalid AI_CORS_ORIGINS entry: ${origin}`); }
    if (origin !== parsed.origin || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) throw new Error(`AI_CORS_ORIGINS requires exact HTTPS origins or local development origins: ${origin}`);
  }
  if (allowedOrigins.length) app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvalidAccessTokenError) return reply.status(401).send({ error: error.message });
    if (error instanceof TooManyAiRequestsError) return reply.header('Retry-After', '60').status(429).send({ error: error.message });
    if (error instanceof ForbiddenCourseError) return reply.status(403).send({ error: error.message });
    if (error instanceof ZodError) return reply.status(400).send({ error: 'Invalid request', issues: error.issues });
    if (error instanceof InvalidChatScopeError) return reply.status(400).send({ error: error.message });
    if (error instanceof UnknownConversationError) return reply.status(404).send({ error: error.message });
    if (error instanceof Error && error.message.startsWith('GEMINI_API_KEY is missing')) return reply.status(503).send({ error: error.message });
    const unavailable = providerFailure(error);
    if (unavailable) return reply.status(503).send({ error: unavailable });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });
  app.get('/health', async () => ({ status: 'ok', service: 'unicheatsheet-ai' }));
  app.get('/v1/health', async () => ({ status: 'ok', service: 'unicheatsheet-ai' }));
  app.get('/v1/ready', async (_request, reply) => {
    try { await db.$queryRaw`SELECT 1`; return { status: 'ready', service: 'unicheatsheet-ai' }; }
    catch { return reply.status(503).send({ status: 'unavailable', service: 'unicheatsheet-ai' }); }
  });
  app.get('/version', async () => ({ version: '0.1.0' }));
  const readContext = async (request: Parameters<AccessContextProvider['getContext']>[0]) => contextProvider.getContext(request);
  const publicContext = async (request: Parameters<AccessContextProvider['getContext']>[0]) => {
    const { userId, ...context } = await readContext(request);
    const accountKey = createHmac('sha256', accountSalt).update(userId).digest('hex');
    const availability = await db.resource.groupBy({ by: ['courseId', 'resourceType'], where: { active: true, courseId: { in: context.allowedCourses.map((course) => course.id) }, academicDocument: { is: { processingStatus: 'indexed', visibility: 'global', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } } }, _count: { _all: true } });
    const resourceAvailability = Object.fromEntries(context.allowedCourses.map((course) => [course.id, availability.filter((row) => row.courseId === course.id).map((row) => row.resourceType)]));
    return { ...context, accountKey, resourceAvailability };
  };
  app.get('/v1/context', async (request) => publicContext(request));
  app.get('/v1/me/context', async (request) => publicContext(request));
  app.get('/v1/courses', async (request) => {
    const context = await readContext(request);
    return db.course.findMany({ where: { id: { in: context.allowedCourses.map((course) => course.id) } }, orderBy: [{ semester: 'asc' }, { name: 'asc' }] });
  });
  app.get('/v1/coverage', async (request) => {
    const context = await readContext(request);
    const rows = await db.academicDocument.groupBy({
      by: ['courseId', 'type'],
      where: { courseId: { in: context.allowedCourses.map((course) => course.id) }, visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] },
      _count: { _all: true }, _max: { updatedAt: true }
    });
    return rows.map((row) => ({ courseId: row.courseId, type: row.type, count: row._count._all, lastIndexedAt: row._max.updatedAt }));
  });
  const extractionCoverage = (metadata: Prisma.JsonValue | undefined) => {
    const pages = metadata && typeof metadata === 'object' && !Array.isArray(metadata) && 'pageExtraction' in metadata ? metadata.pageExtraction : null;
    if (!Array.isArray(pages)) return { needsReviewPageCount: null, ocrPageCount: null };
    return {
      needsReviewPageCount: pages.filter((page) => page && typeof page === 'object' && !Array.isArray(page) && page.needsReview === true).length,
      ocrPageCount: pages.filter((page) => page && typeof page === 'object' && !Array.isArray(page) && page.method !== 'native').length
    };
  };
  const resourceQuerySchema = z.object({
    courseId: z.string().trim().min(1).optional(),
    type: z.enum(['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other']).optional(),
    category: z.enum(['notes', 'pyqs', 'solutions']).optional(),
    unit: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(30)
  }).strict();
  app.get('/v1/resources', async (request) => {
    const query = resourceQuerySchema.parse(request.query);
    const context = await readContext(request);
    const allowedIds = context.allowedCourses.map((course) => course.id);
    if (query.courseId && !allowedIds.includes(query.courseId)) throw new ForbiddenCourseError('Course is outside your allowed courses');
    const categoryTypes = query.category === 'notes' ? ['lecture', 'book', 'syllabus'] as const : query.category === 'solutions' ? ['solution', 'tutorial', 'assignment'] as const : query.category === 'pyqs' ? ['pyq'] as const : undefined;
    const where = { active: true, courseId: { in: query.courseId ? [query.courseId] : allowedIds }, academicDocument: { is: { processingStatus: 'indexed' as const, visibility: 'global' as const, OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } }, ...(query.type ? { resourceType: query.type } : categoryTypes ? { resourceType: { in: [...categoryTypes] } } : {}), ...(query.unit ? { unit: query.unit } : {}) };
    const [total, rows] = await Promise.all([
      db.resource.count({ where }),
      db.resource.findMany({ where, orderBy: [{ courseId: 'asc' }, { resourceType: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, include: { course: { select: { name: true } }, academicDocument: { select: { processingStatus: true, pageCount: true, metadata: true, sourceFile: { select: { active: true } } } } } })
    ]);
    return { page: query.page, limit: query.limit, total, resources: rows.map((row) => ({ id: row.id, courseId: row.courseId, courseName: row.course.name, resourceType: row.resourceType, title: row.title, unit: row.unit, contentFormat: row.contentFormat, documentId: row.academicDocumentId, indexed: row.academicDocument?.processingStatus === 'indexed' && row.academicDocument.sourceFile?.active !== false, pageCount: row.academicDocument?.pageCount ?? null, ...extractionCoverage(row.academicDocument?.metadata) })) };
  });
  app.get('/v1/resources/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await readContext(request);
    const row = await db.resource.findFirst({ where: { id, active: true, courseId: { in: context.allowedCourses.map((course) => course.id) } }, include: { course: { select: { name: true } }, academicDocument: { select: { processingStatus: true, pageCount: true, metadata: true, sourceFile: { select: { active: true } } } } } });
    if (!row) return reply.status(404).send({ error: 'Resource not found' });
    return { id: row.id, courseId: row.courseId, courseName: row.course.name, resourceType: row.resourceType, title: row.title, unit: row.unit, contentFormat: row.contentFormat, documentId: row.academicDocumentId, indexed: row.academicDocument?.processingStatus === 'indexed' && row.academicDocument.sourceFile?.active !== false, pageCount: row.academicDocument?.pageCount ?? null, ...extractionCoverage(row.academicDocument?.metadata) };
  });
  const pyqQuery = z.object({
    courseId: z.string().trim().min(1),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    examType: z.enum(['mid_semester', 'end_semester']).optional(),
    documentId: z.string().trim().min(1).optional(),
    questionNumber: z.string().trim().regex(/^\d{1,3}$/).optional(),
    needsReview: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  }).strict();
  const pyqWhere = async (request: Parameters<AccessContextProvider['getContext']>[0], courseId: string) => {
    const context = await readContext(request);
    if (!context.allowedCourses.some((course) => course.id === courseId)) throw new ForbiddenCourseError('Course is outside your allowed courses');
    return { courseId, document: { processingStatus: 'indexed', visibility: 'global', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } };
  };
  app.get('/v1/pyqs/questions', async (request) => {
    const query = pyqQuery.parse(request.query);
    const where = { ...await pyqWhere(request, query.courseId),
      ...(query.year ? { year: query.year } : {}),
      ...(query.examType ? { examType: query.examType } : {}),
      ...(query.documentId ? { documentId: query.documentId } : {}),
      ...(query.questionNumber ? { questionNumber: query.questionNumber } : {}),
      ...(query.needsReview !== undefined ? { needsReview: query.needsReview } : {}) };
    const [total, rows] = await Promise.all([
      db.examQuestion.count({ where }),
      db.examQuestion.findMany({ where, orderBy: [{ year: 'desc' }, { documentId: 'asc' }, { page: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, include: { document: { select: { title: true } } } })
    ]);
    return { page: query.page, limit: query.limit, total, questions: rows.map(({ document, ...row }) => ({ ...row, paperTitle: document.title })) };
  });
  app.get('/v1/pyqs/repeated', async (request) => {
    const query = pyqQuery.parse(request.query);
    const where = await pyqWhere(request, query.courseId);
    const rows = await db.examQuestion.findMany({ where, take: 5000, orderBy: { documentId: 'asc' }, select: { id: true, documentId: true, chunkId: true, text: true, page: true, year: true, examType: true, needsReview: true, document: { select: { title: true } } } });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const plain = row.text.replace(/^.*?\. Question \d+:\s*/i, '').replace(/^Q(?:uestion)?\.?\s*\d+[).:\s]*/i, '').replace(/\s+/g, ' ').trim();
      const normalized = plain.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normalized.length < 35) continue;
      groups.set(normalized, [...(groups.get(normalized) ?? []), row]);
    }
    const repeated = [...groups.values()].filter((group) => new Set(group.map((item) => item.documentId)).size >= 2).sort((a, b) => new Set(b.map((item) => item.documentId)).size - new Set(a.map((item) => item.documentId)).size);
    return { courseId: query.courseId, analyzedQuestions: rows.length, truncated: rows.length === 5000, total: repeated.length, repeated: repeated.slice((query.page - 1) * query.limit, query.page * query.limit).map((group) => ({ text: group[0]!.text, paperCount: new Set(group.map((item) => item.documentId)).size, appearances: group.map(({ document, ...item }) => ({ ...item, paperTitle: document.title })) })) };
  });
  app.get('/v1/conversations', async (request) => {
    const context = await readContext(request);
    const ids = context.allowedCourses.map((course) => course.id);
    return db.$queryRaw<Array<{ id: string; title: string | null; createdAt: Date; updatedAt: Date }>>`
      SELECT c.id, c.title, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
      FROM conversations c
      WHERE c.user_id = ${context.userId}
        AND c.allowed_course_ids <@ ARRAY[${Prisma.join(ids)}]::text[]
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      ORDER BY c.updated_at DESC LIMIT 50`;
  });
  app.get('/v1/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await readContext(request);
    const conversation = await db.conversation.findFirst({ where: { id, userId: context.userId }, include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, role: true, content: true, citations: true, createdAt: true } } } });
    if (!conversation || !conversation.allowedCourseIds.every((courseId) => context.allowedCourses.some((course) => course.id === courseId))) return reply.status(404).send({ error: 'Conversation not found' });
    const { userId: _userId, allowedCourseIds: _allowedCourseIds, ...visible } = conversation;
    return { ...visible, messages: visible.messages.map((message) => ({ ...message, citations: Array.isArray(message.citations) ? (message.citations as Array<{ sourceUrl: string | null }>).map(safeCitation) : [] })) };
  });
  app.delete('/v1/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await readContext(request);
    const result = await db.conversation.deleteMany({ where: { id, userId: context.userId } });
    if (!result.count) return reply.status(404).send({ error: 'Conversation not found' });
    return reply.status(204).send();
  });
  app.delete('/v1/me/conversations', async (request) => {
    const context = await readContext(request);
    const result = await db.conversation.deleteMany({ where: { userId: context.userId } });
    return { deleted: result.count };
  });
  app.get('/v1/chunks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await readContext(request);
    const release = claim(context.userId);
    let chunk;
    try { chunk = await db.documentChunk.findFirst({ where: { id, courseId: { in: context.allowedCourses.map((course) => course.id) }, document: { visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } }, select: { id: true, content: true, pageStart: true, pageEnd: true, document: { select: { title: true, sourceUrl: true, type: true, metadata: true, course: { select: { id: true, name: true } } } } } }); }
    finally { release(); }
    if (!chunk) return reply.status(404).send({ error: 'Source not found' });
    const pageExtraction = (chunk.document.metadata as { pageExtraction?: Array<{ pageNumber: number; method: string; needsReview: boolean; hasLocalImage: boolean }> } | null)?.pageExtraction?.find((item) => item.pageNumber === chunk.pageStart);
    const { metadata: _metadata, ...document } = chunk.document;
    return { ...chunk, document: { ...document, sourceUrl: hideDirectLinks ? null : document.sourceUrl }, extractionMethod: pageExtraction?.method ?? 'native', needsReview: pageExtraction?.needsReview ?? false, pageImageUrl: process.env.NODE_ENV !== 'production' && pageExtraction?.hasLocalImage ? `/api/ai/chunks/${id}/page-image` : null };
  });
  app.get('/v1/chunks/:id/page-image', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.status(404).send({ error: 'Page preview unavailable' });
    const { id } = request.params as { id: string };
    const context = await readContext(request);
    const chunk = await db.documentChunk.findFirst({ where: { id, courseId: { in: context.allowedCourses.map((course) => course.id) }, document: { visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } }, select: { pageStart: true, document: { select: { checksum: true, metadata: true } } } });
    if (!chunk?.pageStart || !/^[0-9a-f]{64}$/.test(chunk.document.checksum)) return reply.status(404).send({ error: 'Page preview unavailable' });
    const pageExtraction = (chunk.document.metadata as { pageExtraction?: Array<{ pageNumber: number; hasLocalImage: boolean }> } | null)?.pageExtraction?.find((item) => item.pageNumber === chunk.pageStart);
    if (!pageExtraction?.hasLocalImage) return reply.status(404).send({ error: 'Page preview unavailable' });
    const imagePath = resolve(projectRoot, process.env.PAGE_IMAGE_DIR ?? 'data/processing/page-images', chunk.document.checksum, `page-${chunk.pageStart}.png`);
    try { if (!(await stat(imagePath)).isFile()) return reply.status(404).send({ error: 'Page preview unavailable' }); }
    catch { return reply.status(404).send({ error: 'Page preview unavailable' }); }
    return reply.header('cache-control', 'private, no-store').type('image/png').send(createReadStream(imagePath));
  });
  app.post('/v1/retrieve', async (request) => {
    const input = retrieveSchema.parse(request.body);
    const context = await readContext(request);
    const allowedCourseIds = context.allowedCourses.map((course) => course.id);
    if (input.courseId && !allowedCourseIds.includes(input.courseId)) throw new ForbiddenCourseError('Course is outside your allowed courses');
    const release = claim(context.userId);
    try { const results = await retrieve({ ...input, allowedCourseIds }); return { query: input.query, results: hideDirectLinks ? results.map((hit) => ({ ...safeCitation(hit), content: hit.content.slice(0, 500) })) : results }; }
    finally { release(); }
  });
  app.post('/v1/chat', async (request) => {
    const context = await readContext(request);
    const input = chatSchema.parse(request.body);
    const release = claim(context.userId);
    try { const result = await chatService.chat(input, context.allowedCourses.map((course) => course.id), context.userId); return hideDirectLinks ? { ...result, citations: result.citations.map(safeCitation) } : result; }
    finally { release(); }
  });
  app.post('/v1/chat/stream', async (request, reply) => {
    const input = chatSchema.parse(request.body);
    const context = await readContext(request);
    if (input.scope?.courseId && !context.allowedCourses.some((course) => course.id === input.scope?.courseId)) throw new ForbiddenCourseError('Course is outside your allowed courses');
    const release = claim(context.userId);
    reply.hijack();
    const controller = new AbortController();
    reply.raw.once('close', () => controller.abort());
    const origin = request.headers.origin;
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive', ...(origin && allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed && reply.raw.writableLength < 64 * 1024) reply.raw.write(': keepalive\n\n'); }, 15000);
    heartbeat.unref();
    const writeEvent = async (event: string, data: unknown) => {
      if (reply.raw.destroyed) return;
      if (reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return;
      await new Promise<void>((resolve) => {
        const finished = () => { reply.raw.off('drain', finished); reply.raw.off('close', finished); resolve(); };
        reply.raw.once('drain', finished);
        reply.raw.once('close', finished);
      });
    };
    try {
      for await (const item of chatService.stream(input, context.allowedCourses.map((course) => course.id), context.userId, controller.signal)) {
        if (reply.raw.destroyed) break;
        const data = hideDirectLinks && item.event === 'sources' ? (item.data as Array<{ sourceUrl: string | null }>).map(safeCitation) : hideDirectLinks && item.event === 'done' ? { ...(item.data as object), citations: (item.data as { citations: Array<{ sourceUrl: string | null }> }).citations.map(safeCitation) } : item.data;
        await writeEvent(item.event, data);
      }
    } catch (error) {
      if (!controller.signal.aborted) app.log.error(error);
      if (!controller.signal.aborted && !reply.raw.destroyed) await writeEvent('error', { error: providerFailure(error) ?? 'Chat failed. Please try again.' });
    } finally { clearInterval(heartbeat); release(); reply.raw.end(); }
  });
  return app;
}
class TooManyAiRequestsError extends Error { constructor() { super('AI request limit reached. Please try again shortly.'); } }
