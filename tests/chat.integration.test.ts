import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../packages/database/src/index.js';
import { ingestPdf } from '../packages/ingestion/src/index.js';
import { buildApp } from '../apps/api/src/app.js';

process.env.LLM_PROVIDER = 'mock';
process.env.RETRIEVAL_MIN_SCORE = '0.30';
const documentId = 'chat-grounding-fixture';
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
