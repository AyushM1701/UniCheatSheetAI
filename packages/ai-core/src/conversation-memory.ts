import { db } from '@ucs/database';
import type { LLMMessage } from '@ucs/llm';
import type { Citation, ChatInput } from './types.js';
export class UnknownConversationError extends Error {}
export async function getConversation(input: ChatInput, courseId: string | null, semester: number | null, userId: string, allowedCourseIds: string[]): Promise<{ id: string; history: LLMMessage[] }> {
  const scopeIds = courseId ? [courseId] : allowedCourseIds;
  if (!input.conversationId) {
    const created = await db.conversation.create({ data: { title: input.message.slice(0, 100), courseId, semester, userId, allowedCourseIds: scopeIds } });
    return { id: created.id, history: [] };
  }
  const conversation = await db.conversation.findFirst({ where: { id: input.conversationId, userId } });
  if (!conversation) throw new UnknownConversationError('Conversation not found');
  if (!conversation.allowedCourseIds.every((id) => allowedCourseIds.includes(id))) throw new UnknownConversationError('Conversation is outside your current access');
  const usedIds = [...new Set([...conversation.allowedCourseIds, ...scopeIds])];
  if (conversation.courseId !== courseId || conversation.semester !== semester || usedIds.length !== conversation.allowedCourseIds.length) await db.conversation.update({ where: { id: conversation.id }, data: { courseId, semester, allowedCourseIds: usedIds } });
  const recent = await db.message.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 });
  return { id: conversation.id, history: recent.reverse().filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content.slice(0, 4000) })) };
}
export async function saveExchange(conversationId: string, question: string, answer: string, citations: Citation[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.message.create({ data: { conversationId, role: 'user', content: question } });
    await tx.message.create({ data: { conversationId, role: 'assistant', content: answer, citations: citations as object[], sources: citations as object[] } });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  });
}
