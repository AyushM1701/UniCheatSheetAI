import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../packages/database/src/index.js';
import { ingestPdf } from '../packages/ingestion/src/index.js';
import { buildApp } from '../apps/api/src/app.js';

process.env.LLM_PROVIDER = 'mock';
process.env.RETRIEVAL_MIN_SCORE = '0.30';
const documentId = 'chat-grounding-fixture';
const pyqDocumentId = 'chat-digital-pyq-fixture';
const conversations: string[] = [];
const app = buildApp();

async function ask(message: string, scope = { courseId: 'dbms', semester: 3 }, conversationId?: string) {
  const response = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message, scope, conversationId } });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  conversations.push(body.conversationId);
  return body;
}

describe('grounded chat API', () => {
  afterAll(async () => {
    await app.close();
    await db.conversation.deleteMany({ where: { id: { in: conversations } } });
    await db.academicDocument.deleteMany({ where: { id: documentId } });
    await db.academicDocument.deleteMany({ where: { id: pyqDocumentId } });
    await db.$disconnect();
  });
  it('answers from DBMS material and persists a bounded conversation', async () => {
    await db.course.upsert({ where: { id: 'dbms' }, create: { id: 'dbms', name: 'Database Management Systems', semester: 3 }, update: {} });
    await ingestPdf({ documentId, courseId: 'dbms', title: 'DBMS Chat Fixture', type: 'lecture', source: 'test', filePath: 'data/samples/dbms-normalization.pdf' });
    const first = await ask('Explain 3NF using UniCheatSheet DBMS material');
    expect(first.metadata.intent).toBe('academic_rag');
    expect(['chat-grounding-fixture', 'dbms-normalization-sample']).toContain(first.citations[0]?.documentId);
    expect(first.citations[0]).toMatchObject({ page: 1 });
    expect(first.citations[0]).toMatchObject({ courseId: 'dbms' });
    expect(first.answer).toContain('[S1]');
    const second = await ask('What is it for?', { courseId: 'dbms', semester: 3 }, first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    expect(await db.message.count({ where: { conversationId: first.conversationId } })).toBe(4);
    const stored = await app.inject({ method: 'GET', url: `/v1/conversations/${first.conversationId}` });
    expect(stored.json()).toMatchObject({ courseId: 'dbms', semester: 3 });
    expect(stored.json().messages).toHaveLength(4);
  });
  it('does not create an empty conversation when generation fails', async () => {
    const message = 'Explain 3NF using UniCheatSheet DBMS material';
    const before = await db.conversation.count({ where: { title: message, userId: 'dev-local' } });
    const previous = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'unavailable-test-provider';
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message, scope: { courseId: 'dbms' } } });
      expect(response.statusCode).toBe(500);
    } finally { process.env.LLM_PROVIDER = previous; }
    expect(await db.conversation.count({ where: { title: message, userId: 'dev-local' } })).toBe(before);
  });
  it('does not present absent AES content as UniCheatSheet knowledge', async () => {
    const result = await ask('What do my DBMS notes say about AES encryption?');
    expect(result.citations).toEqual([]);
    expect(result.answer).toMatch(/could not find relevant information/i);
  });
  it('keeps PYQ lookup separate from practice generation', async () => {
    const pyq = await ask('Give me DBMS PYQs on normalization');
    expect(pyq.metadata.intent).toBe('resource_search');
    expect(pyq.answer).toMatch(/could not find matching indexed PYQs/i);
    expect(pyq.citations).toEqual([]);
    const practice = await ask('Generate practice questions on normalization');
    expect(practice.metadata.intent).toBe('practice_generation');
    expect(practice.answer).toMatch(/Generated practice question \(not a PYQ\)/);
    expect(practice.citations).toHaveLength(1);
  });
  it('browses allowed course PYQs for a broad question request without a selected course', async () => {
    await db.course.upsert({ where: { id: 'digital-electronics' }, create: { id: 'digital-electronics', name: 'Digital Electronics (B.Tech CSE)', semester: 3 }, update: {} });
    await db.academicDocument.upsert({
      where: { id: pyqDocumentId },
      create: { id: pyqDocumentId, courseId: 'digital-electronics', title: 'Digital Electronics Test PYQ', type: 'pyq', source: 'test', checksum: 'fixture', processingStatus: 'indexed' },
      update: { processingStatus: 'indexed' }
    });
    await db.documentChunk.deleteMany({ where: { documentId: pyqDocumentId } });
    await db.documentChunk.create({ data: { documentId: pyqDocumentId, courseId: 'digital-electronics', chunkIndex: 0, content: 'Digital Electronics Test PYQ. Question 1: Q1 Design a two input NAND gate with CMOS logic.', page: 1, pageStart: 1, pageEnd: 1 } });
    await db.documentChunk.create({ data: { documentId: pyqDocumentId, courseId: 'digital-electronics', chunkIndex: 1, content: 'Digital Electronics Test PYQ. Question 2: Q2 Convert a JK flip-flop to a T flip-flop.', page: 1, pageStart: 1, pageEnd: 1 } });
    const response = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'give me some questions on digital electronics based on the pyqs' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    conversations.push(body.conversationId);
    expect(body.metadata).toMatchObject({ courseId: 'digital-electronics', intent: 'resource_search' });
    expect(body.answer).toContain('Design a two input NAND gate');
    expect(body.answer).toContain('explain it step by step');
    expect(body.citations.some((citation: { documentId: string }) => citation.documentId === pyqDocumentId)).toBe(true);
    const followUp = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'solve question 1', conversationId: body.conversationId } });
    expect(followUp.statusCode).toBe(200);
    expect(followUp.json().metadata.intent).toBe('academic_rag');
    expect(followUp.json().citations[0]?.chunkId).toBe(body.citations[0]?.chunkId);
    const second = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'solve the second one', conversationId: body.conversationId } });
    expect(second.statusCode).toBe(200);
    expect(second.json().citations[0]?.chunkId).toBe(body.citations[1]?.chunkId);
  });
  it('streams status, source, token and done events', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/chat/stream', payload: { message: 'Explain normalization', scope: { courseId: 'dbms' } } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toContain('event: status');
    expect(response.payload).toContain('event: sources');
    expect(response.payload).toContain('event: token');
    expect(response.payload).toContain('event: done');
    const done = response.payload.match(/event: done\ndata: ([^\n]+)/);
    expect(done).not.toBeNull();
    conversations.push(JSON.parse(done![1]!).conversationId);
  });
  it('lists only entitled indexed resources and enforces document scope', async () => {
    const listing = await app.inject({ method: 'GET', url: '/v1/resources?courseId=dbms' });
    expect(listing.statusCode).toBe(200);
    expect(listing.json().resources.some((resource: { documentId: string }) => resource.documentId === documentId)).toBe(true);
    const resource = listing.json().resources.find((item: { documentId: string }) => item.documentId === documentId);
    const scoped = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'Explain normalization from this document', mode: 'notes', scope: { resourceId: resource.id, documentId, courseId: 'dbms' } } });
    expect(scoped.statusCode).toBe(200);
    conversations.push(scoped.json().conversationId);
    expect(scoped.json().citations.every((citation: { documentId: string }) => citation.documentId === documentId)).toBe(true);
    const wrongCourse = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'Explain normalization', scope: { documentId, courseId: 'physics' } } });
    expect(wrongCourse.statusCode).toBe(400);
    const restricted = buildApp({ getContext: async () => ({ userId: 'restricted-resource-test', semester: 3, allowedCourses: [{ id: 'physics', name: 'Physics' }] }) });
    try {
      expect((await restricted.inject({ method: 'GET', url: '/v1/resources?courseId=dbms' })).statusCode).toBe(403);
      expect((await restricted.inject({ method: 'GET', url: `/v1/resources/${encodeURIComponent(resource.id)}` })).statusCode).toBe(404);
      expect((await restricted.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'Explain normalization', scope: { documentId } } })).statusCode).toBe(400);
    } finally { await restricted.close(); }
  });
  it('lets an account delete its own conversation without deleting another account\'s', async () => {
    const own = await ask('Explain 3NF from DBMS notes');
    const other = buildApp({ getContext: async () => ({ userId: 'other-account', semester: 3, allowedCourses: [{ id: 'dbms', name: 'Database Management Systems' }] }) });
    try {
      expect((await other.inject({ method: 'DELETE', url: `/v1/conversations/${own.conversationId}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/v1/conversations/${own.conversationId}` })).statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/v1/conversations/${own.conversationId}` })).statusCode).toBe(404);
    } finally { await other.close(); }
  });
  it('keeps structured PYQ queries within the allowed course set', async () => {
    const allowed = await app.inject({ method: 'GET', url: '/v1/pyqs/questions?courseId=digital-electronics&limit=5' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ page: 1, limit: 5 });
    const restricted = buildApp({ getContext: async () => ({ userId: 'restricted-pyq-test', semester: 3, allowedCourses: [{ id: 'dbms', name: 'Database Management Systems' }] }) });
    try {
      expect((await restricted.inject({ method: 'GET', url: '/v1/pyqs/questions?courseId=digital-electronics' })).statusCode).toBe(403);
      expect((await restricted.inject({ method: 'GET', url: '/v1/pyqs/repeated?courseId=digital-electronics' })).statusCode).toBe(403);
    } finally { await restricted.close(); }
  });
  it('rejects a browser-selected course outside the server context', async () => {
    const restricted = buildApp({ getContext: async () => ({ userId: 'restricted-test', semester: 3, allowedCourses: [{ id: 'physics', name: 'Physics' }] }) });
    try {
      const response = await restricted.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'Explain DBMS normalization', scope: { courseId: 'dbms' } } });
      expect(response.statusCode).toBe(403);
      const search = await restricted.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: 'normalization', courseId: 'dbms' } });
      expect(search.statusCode).toBe(403);
      const courses = await restricted.inject({ method: 'GET', url: '/v1/context' });
      expect(courses.json().allowedCourses).toEqual([{ id: 'physics', name: 'Physics' }]);
    } finally { await restricted.close(); }
  });
});
