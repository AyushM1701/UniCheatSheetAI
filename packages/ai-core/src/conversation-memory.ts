import { db } from '@ucs/database';
import { randomUUID } from 'node:crypto';
import type { LLMMessage } from '@ucs/llm';
import type { Citation, ChatInput } from './types.js';
export class UnknownConversationError extends Error {}
export interface ConversationState { id: string; title: string; courseId: string | null; semester: number | null; userId: string; allowedCourseIds: string[]; history: LLMMessage[]; lastCitations: Citation[] }
export async function getConversation(input: ChatInput, courseId: string | null, semester: number | null, userId: string, allowedCourseIds: string[]): Promise<ConversationState> {
  const scopeIds = courseId ? [courseId] : allowedCourseIds;
  if (!input.conversationId) {
    return { id: randomUUID(), title: input.message.slice(0, 100), courseId, semester, userId, allowedCourseIds: scopeIds, history: [], lastCitations: [] };
  }
  const conversation = await db.conversation.findFirst({ where: { id: input.conversationId, userId } });
  if (!conversation) throw new UnknownConversationError('Conversation not found');
  if (!conversation.allowedCourseIds.every((id) => allowedCourseIds.includes(id))) throw new UnknownConversationError('Conversation is outside your current access');
  const usedIds = [...new Set([...conversation.allowedCourseIds, ...scopeIds])];
  const changedCourse = conversation.courseId !== courseId;
  const state = { id: conversation.id, title: conversation.title ?? input.message.slice(0, 100), courseId, semester, userId, allowedCourseIds: usedIds };
  if (changedCourse) return { ...state, history: [], lastCitations: [] };
  const recent = await db.message.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 });
  const lastAssistant = recent.find((item) => item.role === 'assistant' && /^Here are \d+ questions from your indexed past papers:/.test(item.content))
    ?? recent.find((item) => item.role === 'assistant');
  const lastCitations = Array.isArray(lastAssistant?.citations)
    ? lastAssistant.citations.filter((item): item is typeof item & { chunkId: string } => !!item && typeof item === 'object' && !Array.isArray(item) && typeof item.chunkId === 'string') as unknown as Citation[]
    : [];
  return { ...state, lastCitations, history: recent.reverse().filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content.replace(/\[S\d+\]/g, '').slice(0, 4000) })) };
}
export async function saveExchange(conversation: ConversationState, question: string, answer: string, citations: Citation[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.conversation.upsert({ where: { id: conversation.id }, create: { id: conversation.id, title: conversation.title, courseId: conversation.courseId, semester: conversation.semester, userId: conversation.userId, allowedCourseIds: conversation.allowedCourseIds }, update: { courseId: conversation.courseId, semester: conversation.semester, allowedCourseIds: conversation.allowedCourseIds } });
    await tx.message.create({ data: { conversationId: conversation.id, role: 'user', content: question } });
    await tx.message.create({ data: { conversationId: conversation.id, role: 'assistant', content: answer, citations: citations as object[], sources: citations as object[] } });
    await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  });
}
