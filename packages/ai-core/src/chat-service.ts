import { db } from '@ucs/database';
import { getLLMProvider } from '@ucs/llm';
import { retrieve } from '@ucs/retrieval';
import { buildContext } from './context-builder.js';
import { validateCitations } from './citation-engine.js';
import { getConversation, saveExchange } from './conversation-memory.js';
import { buildPrompt } from './prompt-builder.js';
import { retrievalQuery, routeQuery } from './query-router.js';
import type { ChatInput, ChatResult, CitedSource, QueryIntent } from './types.js';

const noSources = 'I could not find relevant information in the indexed UniCheatSheet material.';
export class InvalidChatScopeError extends Error {}
export class ForbiddenCourseError extends Error {}
type Prepared = { input: ChatInput; intent: QueryIntent; courseId: string | null; courseName: string | null; sources: CitedSource[]; conversationId: string; history: Awaited<ReturnType<typeof getConversation>>['history']; directAnswer?: string };

async function resolveCourse(input: ChatInput, allowedCourseIds: string[], userId: string): Promise<{ courseId: string | null; courseName: string | null }> {
  if (input.scope?.courseId) {
    if (!allowedCourseIds.includes(input.scope.courseId)) throw new ForbiddenCourseError('Course is outside your allowed courses');
    const course = await db.course.findUnique({ where: { id: input.scope.courseId } });
    if (!course || (input.scope.semester && course.semester !== input.scope.semester)) throw new InvalidChatScopeError('Unknown course or semester mismatch');
    return { courseId: course.id, courseName: course.name };
  }
  const courses = await db.course.findMany({ where: { id: { in: allowedCourseIds }, ...(input.scope?.semester ? { semester: input.scope.semester } : {}) } });
  if (input.conversationId && !input.scope) {
    const conversation = await db.conversation.findFirst({ where: { id: input.conversationId, userId }, select: { courseId: true } });
    const saved = conversation?.courseId ? courses.find((course) => course.id === conversation.courseId) : null;
    if (saved) return { courseId: saved.id, courseName: saved.name };
  }
  return { courseId: null, courseName: null };
}

async function prepare(input: ChatInput, allowedCourseIds: string[], userId: string): Promise<Prepared> {
  if (!allowedCourseIds.length) throw new InvalidChatScopeError('No courses are available');
  if (input.conversationId) {
    const saved = await db.conversation.findFirst({ where: { id: input.conversationId, userId }, select: { courseId: true, allowedCourseIds: true } });
    if (!saved) throw new InvalidChatScopeError('Conversation is unavailable');
    if (!saved.allowedCourseIds.every((id) => allowedCourseIds.includes(id))) throw new InvalidChatScopeError('Conversation is outside your current access');
    if (saved?.courseId && !allowedCourseIds.includes(saved.courseId)) throw new InvalidChatScopeError('Conversation is outside your allowed courses');
  }
  const intent = routeQuery(input.message);
  const { courseId, courseName } = await resolveCourse(input, allowedCourseIds, userId);
  const conversation = await getConversation(input, courseId, input.scope?.semester ?? (courseId ? (await db.course.findUnique({ where: { id: courseId }, select: { semester: true } }))?.semester ?? null : null), userId, allowedCourseIds);
  if (intent === 'general_chat') return { input, intent, courseId, courseName, conversationId: conversation.id, history: conversation.history, sources: [], directAnswer: 'Hi! Ask me about your UniCheatSheet course material.' };
  if (intent === 'database_query') {
    const pyqOnly = /\b(pyqs?|previous year|past papers?|question papers?)\b/i.test(input.message);
    const requestedType = pyqOnly ? 'pyq' : /\btutorials?\b/i.test(input.message) ? 'tutorial' : /\bassignments?\b/i.test(input.message) ? 'assignment' : /\bsolutions?\b/i.test(input.message) ? 'solution' : /\blectures?|notes?\b/i.test(input.message) ? 'lecture' : null;
    const count = await db.academicDocument.count({ where: { visibility: 'global', processingStatus: 'indexed', courseId: { in: courseId ? [courseId] : allowedCourseIds }, ...(input.scope?.semester ? { course: { semester: input.scope.semester } } : {}), ...(requestedType ? { type: requestedType } : {}), OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } });
    const label = requestedType ? `${requestedType} documents` : 'indexed documents';
    return { input, intent, courseId, courseName, conversationId: conversation.id, history: conversation.history, sources: [], directAnswer: `I found ${count} ${label}${courseName ? ` for ${courseName}` : ''}.` };
  }
  const hits = await retrieve({ query: retrievalQuery(input.message, courseId, conversation.history), allowedCourseIds, ...(courseId ? { courseId } : {}), ...(input.scope?.semester ? { semester: input.scope.semester } : {}), ...(intent === 'resource_search' ? { type: 'pyq' as const } : {}), limit: 12 });
  const sources = buildContext(hits);
  if (intent === 'resource_search') {
    const answer = sources.length ? `I found these indexed PYQ passages:\n${sources.map(({ id, hit }) => `- ${hit.documentTitle}${hit.page ? `, page ${hit.page}` : ''} [${id}]`).join('\n')}` : 'I could not find matching indexed PYQs. I have not generated any questions.';
    return { input, intent, courseId, courseName, conversationId: conversation.id, history: conversation.history, sources, directAnswer: answer };
  }
  return { input, intent, courseId, courseName, conversationId: conversation.id, history: conversation.history, sources, ...(sources.length ? {} : { directAnswer: noSources }) };
}

async function complete(prepared: Prepared, rawAnswer: string): Promise<ChatResult> {
  const { answer: validated, citations } = validateCitations(rawAnswer, prepared.sources);
  let answer = validated || noSources;
  if (prepared.sources.length && !prepared.directAnswer && !citations.length) answer = noSources;
  await saveExchange(prepared.conversationId, prepared.input.message, answer, citations);
  return { conversationId: prepared.conversationId, answer, citations, metadata: { courseId: prepared.courseId, intent: prepared.intent, retrievedChunks: prepared.sources.length, provider: prepared.directAnswer ? 'deterministic' : (process.env.LLM_PROVIDER ?? 'gemini') } };
}

export const chatService = {
  async chat(input: ChatInput, allowedCourseIds: string[], userId: string): Promise<ChatResult> {
    const prepared = await prepare(input, allowedCourseIds, userId);
    const raw = prepared.directAnswer ?? await getLLMProvider().generate(buildPrompt({ message: input.message, courseName: prepared.courseName, intent: prepared.intent, sources: prepared.sources, history: prepared.history }));
    return complete(prepared, raw);
  },
  async *stream(input: ChatInput, allowedCourseIds: string[], userId: string): AsyncIterable<{ event: 'status' | 'sources' | 'token' | 'done'; data: unknown }> {
    yield { event: 'status', data: { status: 'retrieving' } };
    const prepared = await prepare(input, allowedCourseIds, userId);
    yield { event: 'sources', data: prepared.sources.map((source) => source.citation) };
    yield { event: 'status', data: { status: 'generating' } };
    let raw = prepared.directAnswer ?? '';
    const allowed = new Set(prepared.sources.map((source) => source.id));
    const sanitize = (value: string) => value.replace(/\[S(\d+)\]/g, (match, number: string) => allowed.has(`S${number}`) ? match : '').replace(/https?:\/\/\S+/g, '');
    let pending = '';
    if (!prepared.directAnswer) {
      for await (const part of getLLMProvider().stream(buildPrompt({ message: input.message, courseName: prepared.courseName, intent: prepared.intent, sources: prepared.sources, history: prepared.history }))) {
        raw += part;
        pending += part;
        let cut = Math.max(0, pending.length - 16);
        const url = pending.search(/https?:\/\/\S*$/);
        if (url >= 0) cut = Math.min(cut, url);
        const bracket = pending.lastIndexOf('[');
        if (bracket >= 0 && pending.indexOf(']', bracket) < 0) cut = Math.min(cut, bracket);
        if (cut > 0) {
          const text = sanitize(pending.slice(0, cut));
          pending = pending.slice(cut);
          if (text) yield { event: 'token', data: { text } };
        }
      }
    }
    if (pending) { const text = sanitize(pending); if (text) yield { event: 'token', data: { text } }; }
    const result = await complete(prepared, raw);
    if (prepared.directAnswer) for (const text of result.answer.match(/\S+\s*/g) ?? []) yield { event: 'token', data: { text } };
    yield { event: 'done', data: result };
  }
};
