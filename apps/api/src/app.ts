import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
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
  if (allowedOrigins.length) app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] });
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
    return { ...context, accountKey: createHash('sha256').update(userId).digest('hex') };
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
  app.get('/v1/chunks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const chunk = await db.documentChunk.findFirst({ where: { id, courseId: { in: (await readContext(request)).allowedCourses.map((course) => course.id) }, document: { visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } }, select: { id: true, content: true, pageStart: true, pageEnd: true, document: { select: { title: true, sourceUrl: true, type: true, metadata: true, course: { select: { id: true, name: true } } } } } });
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
    try { const results = await retrieve({ ...input, allowedCourseIds }); return { query: input.query, results: hideDirectLinks ? results.map(safeCitation) : results }; }
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
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', ...(origin && allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
    try {
      for await (const item of chatService.stream(input, context.allowedCourses.map((course) => course.id), context.userId, controller.signal)) {
        if (reply.raw.destroyed) break;
        const data = hideDirectLinks && item.event === 'sources' ? (item.data as Array<{ sourceUrl: string | null }>).map(safeCitation) : hideDirectLinks && item.event === 'done' ? { ...(item.data as object), citations: (item.data as { citations: Array<{ sourceUrl: string | null }> }).citations.map(safeCitation) } : item.data;
        reply.raw.write(`event: ${item.event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    } catch (error) {
      if (!controller.signal.aborted) app.log.error(error);
      if (!controller.signal.aborted && !reply.raw.destroyed) reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: providerFailure(error) ?? 'Chat failed. Please try again.' })}\n\n`);
    } finally { release(); reply.raw.end(); }
  });
  app.get('/v1/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const document = await db.academicDocument.findFirst({ where: { id, courseId: { in: (await readContext(request)).allowedCourses.map((course) => course.id) }, visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] }, include: { chunks: { orderBy: { chunkIndex: 'asc' }, select: { id: true, chunkIndex: true, page: true, pageStart: true, pageEnd: true, tokenEstimate: true, content: true } } } });
    if (!document) return reply.status(404).send({ error: 'Document not found' });
    const { filePath: _filePath, checksum: _checksum, metadata: _metadata, ownerUserId: _ownerUserId, ...visible } = document;
    return { ...visible, sourceUrl: hideDirectLinks ? null : document.sourceUrl };
  });
  return app;
}
class TooManyAiRequestsError extends Error { constructor() { super('AI request limit reached. Please try again shortly.'); } }
