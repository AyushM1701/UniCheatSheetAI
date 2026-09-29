import { db } from '@ucs/database';
import { getLLMProvider } from '@ucs/llm';
import { retrieve } from '@ucs/retrieval';
import type { RetrievalHit } from '@ucs/retrieval';
import { buildContext } from './context-builder.js';
import { validateCitations } from './citation-engine.js';
import { getConversation, saveExchange, type ConversationState } from './conversation-memory.js';
import { buildPrompt } from './prompt-builder.js';
import { browsePyqQuestions, loadCitedPyqQuestion } from './pyq-browser.js';
import { pyqTopicQuery, retrievalQuery, routeQuery } from './query-router.js';
import type { ChatInput, ChatResult, CitedSource, QueryIntent } from './types.js';

const noSources = 'I could not find relevant information in the indexed UniCheatSheet material.';
export class InvalidChatScopeError extends Error {}
export class ForbiddenCourseError extends Error {}
type Prepared = { input: ChatInput; intent: QueryIntent; courseId: string | null; courseName: string | null; sources: CitedSource[]; conversation: ConversationState; history: ConversationState['history']; directAnswer?: string };
export function selectResourceHits(hits: RetrievalHit[]): RetrievalHit[] {
  const lexical = hits.filter((hit) => hit.lexicalMatch);
  if (lexical.length) return lexical;
  const strongest = hits[0]?.similarity ?? 0;
  return hits.filter((hit) => hit.similarity >= Math.max(0.35, strongest * 0.75));
}
function mentionedCourse<T extends { id: string; name: string; aliases: string[] }>(message: string, courses: T[]): T | null {
  const matches = courses.filter((course) => {
    const names = [course.id.replace(/-/g, ' '), course.name.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), ...course.aliases];
    return names.some((name) => name.length >= 3 && new RegExp(`\\b${name.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+')}\\b`, 'i').test(message));
  });
  return matches.length === 1 ? matches[0]! : null;
}

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
  const mentioned = mentionedCourse(input.message, courses);
  if (mentioned) return { courseId: mentioned.id, courseName: mentioned.name };
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
  const teach = /\b(explain|solve|answer|work through|walk through|teach|derive|demonstrate)\b/i.test(input.message);
  const intent: QueryIntent = input.mode === 'practice' ? 'practice_generation' : input.mode === 'pyqs' ? teach ? 'academic_rag' : 'resource_search' : input.mode === 'notes' || input.mode === 'solutions' ? 'academic_rag' : routeQuery(input.message);
  let scopedDocumentId = input.scope?.documentId;
  let scopedCourseId: string | null = null;
  if (input.scope?.resourceId) {
    const resource = await db.resource.findFirst({ where: { id: input.scope.resourceId, active: true, courseId: { in: allowedCourseIds }, academicDocument: { is: { visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } } }, select: { courseId: true, academicDocumentId: true } });
    if (!resource?.academicDocumentId) throw new InvalidChatScopeError('Resource is unavailable');
    if (scopedDocumentId && scopedDocumentId !== resource.academicDocumentId) throw new InvalidChatScopeError('Resource and document scope disagree');
    scopedDocumentId = resource.academicDocumentId;
    scopedCourseId = resource.courseId;
  }
  if (scopedDocumentId) {
    const document = await db.academicDocument.findFirst({ where: { id: scopedDocumentId, courseId: { in: allowedCourseIds }, visibility: 'global', processingStatus: 'indexed', OR: [{ sourceFile: null }, { sourceFile: { active: true } }] }, select: { courseId: true } });
    if (!document) throw new InvalidChatScopeError('Document is unavailable');
    if (scopedCourseId && scopedCourseId !== document.courseId) throw new InvalidChatScopeError('Resource and document scope disagree');
    scopedCourseId = document.courseId;
  }
  if (scopedCourseId && input.scope?.courseId && scopedCourseId !== input.scope.courseId) throw new InvalidChatScopeError('Course and document scope disagree');
  const { courseId, courseName } = scopedCourseId
    ? { courseId: scopedCourseId, courseName: (await db.course.findUnique({ where: { id: scopedCourseId }, select: { name: true } }))?.name ?? null }
    : await resolveCourse(input, allowedCourseIds, userId);
  const conversation = await getConversation(input, courseId, input.scope?.semester ?? (courseId ? (await db.course.findUnique({ where: { id: courseId }, select: { semester: true } }))?.semester ?? null : null), userId, allowedCourseIds);
  if (intent === 'general_chat') return { input, intent, courseId, courseName, conversation, history: conversation.history, sources: [], directAnswer: 'Hi! Ask me about your UniCheatSheet course material.' };
  if (intent === 'database_query') {
    const pyqOnly = /\b(pyqs?|previous year|past[-\s]+papers?|question[-\s]+papers?)\b/i.test(input.message);
    const requestedType = pyqOnly ? 'pyq' : /\btutorials?\b/i.test(input.message) ? 'tutorial' : /\bassignments?\b/i.test(input.message) ? 'assignment' : /\bsolutions?\b/i.test(input.message) ? 'solution' : /\blectures?|notes?\b/i.test(input.message) ? 'lecture' : null;
    const count = await db.academicDocument.count({ where: { visibility: 'global', processingStatus: 'indexed', courseId: { in: courseId ? [courseId] : allowedCourseIds }, ...(input.scope?.semester ? { course: { semester: input.scope.semester } } : {}), ...(requestedType ? { type: requestedType } : {}), OR: [{ sourceFile: null }, { sourceFile: { active: true } }] } });
    const label = requestedType ? `${requestedType} documents` : 'indexed documents';
    return { input, intent, courseId, courseName, conversation, history: conversation.history, sources: [], directAnswer: `I found ${count} ${label}${courseName ? ` for ${courseName}` : ''}.` };
  }
  const query = retrievalQuery(input.message, courseId, conversation.history);
  const pyqMention = /\b(pyqs?|previous year|past[-\s]+papers?|question[-\s]+papers?)\b/i.test(input.message);
  const pyqQuery = input.mode === 'pyqs' || intent === 'resource_search' || (intent === 'practice_generation' && pyqMention);
  const pyqTopic = pyqQuery ? pyqTopicQuery(input.message, courseId, conversation.history) : query;
  const modeTypes = input.mode === 'notes' ? ['lecture', 'book', 'syllabus'] as const : input.mode === 'solutions' ? ['solution', 'tutorial', 'assignment'] as const : input.mode === 'pyqs' ? ['pyq'] as const : undefined;
  const resourceTypes = input.scope?.resourceTypes ?? (modeTypes ? [...modeTypes] : undefined);
  const numericQuestion = input.message.match(/\b(?:question|q|number|no\.?)\s*(\d{1,2})\b/i)?.[1];
  const ordinalQuestion = /\b(?:solve|explain|answer|work through|walk through)\b/i.test(input.message)
    ? ['first', 'second', 'third', 'fourth', 'fifth'].findIndex((word) => new RegExp(`\\b${word}(?:\\s+(?:one|question))?\\b`, 'i').test(input.message)) + 1
    : 0;
  const selectedNumber = intent === 'academic_rag' && input.conversationId ? Number(numericQuestion ?? ordinalQuestion) : 0;
  const selectedCitation = selectedNumber > 0 ? conversation.lastCitations[selectedNumber - 1] : undefined;
  const selectedQuestion = selectedCitation ? await loadCitedPyqQuestion(selectedCitation.chunkId, courseId ? [courseId] : allowedCourseIds) : null;
  const hits = selectedQuestion ? [selectedQuestion] : pyqQuery && !pyqTopic
    ? await browsePyqQuestions(courseId ? [courseId] : allowedCourseIds, input.scope?.semester, 5, scopedDocumentId)
    : await retrieve({ query: pyqQuery ? pyqTopic : query || input.message, allowedCourseIds, ...(courseId ? { courseId } : {}), ...(input.scope?.semester ? { semester: input.scope.semester } : {}), ...(scopedDocumentId ? { documentId: scopedDocumentId } : {}), ...(input.scope?.resourceId ? { resourceId: input.scope.resourceId } : {}), ...(pyqQuery ? { type: 'pyq' as const } : resourceTypes ? { resourceTypes } : {}), limit: 12 });
  const sources = buildContext(intent === 'resource_search' ? selectResourceHits(hits) : hits);
  if (intent === 'resource_search') {
    const answer = sources.length ? `Here are ${sources.length} questions from your indexed past papers:\n${sources.map(({ id, hit }, index) => {
      const raw = hit.content.startsWith(`${hit.documentTitle}. `) ? hit.content.slice(hit.documentTitle.length + 2) : hit.content;
      const question = raw.replace(/^Question \d+:\s*Q(?:\d+|[Il])\s*/i, '').replace(/\s+\d{1,2}\s+col\b(?=\s*\([a-z]\))/i, ' ').replace(/\s+\d{1,2}\s+CO\d\b.*$/i, '').replace(/\s+\d{1,2}\s+(?:CO\d|col)\s*$/i, '').replace(/https?:\/\/\S+/g, '').trim();
      return `${index + 1}. ${question}${hit.page ? ` (page ${hit.page})` : ''} [${id}]`;
    }).join('\n')}\n\nTell me which one you want to solve, and I will explain it step by step.${sources.some(({ hit }) => hit.extractionMethod !== 'native') ? '\n\nThese questions were transcribed from scanned pages. Check the original page for exact wording, symbols, and marks.' : ''}` : 'I could not find matching indexed PYQs for the courses you can access. I have not generated any questions.';
    return { input, intent, courseId, courseName, conversation, history: conversation.history, sources, directAnswer: answer };
  }
  return { input, intent, courseId, courseName, conversation, history: conversation.history, sources };
}

async function complete(prepared: Prepared, rawAnswer: string): Promise<ChatResult> {
  const { answer: validated, citations } = validateCitations(rawAnswer, prepared.sources);
  let answer = validated || noSources;
  if (prepared.sources.length && !prepared.directAnswer && !citations.length) answer = noSources;
  await saveExchange(prepared.conversation, prepared.input.message, answer, citations);
  const model = prepared.directAnswer ? null : getLLMProvider().capabilities;
  const provenance = answer === noSources || /I could not find matching indexed PYQs/i.test(answer) ? 'insufficient'
    : prepared.intent === 'database_query' || prepared.intent === 'resource_search' && citations.length ? 'grounded'
      : citations.length ? 'mixed' : 'general';
  return { conversationId: prepared.conversation.id, answer, citations, metadata: { courseId: prepared.courseId, intent: prepared.intent, retrievedChunks: prepared.sources.length, provider: model?.provider ?? 'deterministic', model: model?.model ?? null, provenance, sourceSupportVerified: provenance === 'grounded' } };
}

export const chatService = {
  async chat(input: ChatInput, allowedCourseIds: string[], userId: string): Promise<ChatResult> {
    const prepared = await prepare(input, allowedCourseIds, userId);
    const raw = prepared.directAnswer ?? await getLLMProvider().generate(buildPrompt({ message: input.message, courseName: prepared.courseName, intent: prepared.intent, sources: prepared.sources, history: prepared.history }));
    return complete(prepared, raw);
  },
  async *stream(input: ChatInput, allowedCourseIds: string[], userId: string, signal?: AbortSignal): AsyncIterable<{ event: 'status' | 'sources' | 'token' | 'done'; data: unknown }> {
    yield { event: 'status', data: { status: 'retrieving' } };
    const prepared = await prepare(input, allowedCourseIds, userId);
    if (signal?.aborted) return;
    yield { event: 'sources', data: prepared.sources.map((source) => source.citation) };
    yield { event: 'status', data: { status: 'generating' } };
    let raw = prepared.directAnswer ?? '';
    if (!prepared.directAnswer) {
      let pending = '';
      const safeDelta = (text: string) => text.replace(/https?:\/\/\S+/gi, '').replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (match, group: string) => {
        if (prepared.sources.length && prepared.sources.every((source) => source.hit.type === 'pyq')) return '';
        return group.split(/\s*,\s*/).every((id) => prepared.sources.some((source) => source.id === id)) ? match : '';
      });
      for await (const part of getLLMProvider().stream(buildPrompt({ message: input.message, courseName: prepared.courseName, intent: prepared.intent, sources: prepared.sources, history: prepared.history }), signal)) {
        if (signal?.aborted) return;
        raw += part;
        pending += part;
        let boundary = pending.lastIndexOf(' ');
        const opening = pending.lastIndexOf('[');
        if (opening > pending.lastIndexOf(']') && boundary >= opening) boundary = pending.lastIndexOf(' ', opening - 1);
        if (boundary >= 0) {
          const delta = safeDelta(pending.slice(0, boundary + 1));
          pending = pending.slice(boundary + 1);
          if (delta) yield { event: 'token', data: { text: delta } };
        }
      }
      if (pending) {
        const delta = safeDelta(pending);
        if (delta) yield { event: 'token', data: { text: delta } };
      }
    }
    if (signal?.aborted) return;
    const result = await complete(prepared, raw);
    if (prepared.directAnswer) for (const text of result.answer.match(/.{1,240}/gs) ?? []) yield { event: 'token', data: { text } };
    yield { event: 'done', data: result };
  }
};
