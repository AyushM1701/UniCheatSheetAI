import type { ChatResult, ChatScope, Citation, Conversation, ConversationSummary, Course, SourceDetail } from '@/types/chat';
import type { UserAcademicContext } from '@/types/chat';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/ai/${path}`, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export interface ChatRequest { message: string; conversationId?: string | null; scope?: Pick<ChatScope, 'semester' | 'courseId'> }
export const ai = {
  getContext: () => request<UserAcademicContext>('context'),
  getCourses: () => request<Course[]>('courses'),
  getConversations: () => request<ConversationSummary[]>('conversations'),
  getConversation: (id: string) => request<Conversation>(`conversations/${encodeURIComponent(id)}`),
  getSource: (id: string) => request<SourceDetail>(`chunks/${encodeURIComponent(id)}`),
  retrieve: (query: string, courseId?: string) => request<{ query: string; results: unknown[] }>('retrieve', { method: 'POST', body: JSON.stringify({ query, courseId }) }),
  search: (query: string, courseId?: string) => request<{ query: string; results: unknown[] }>('retrieve', { method: 'POST', body: JSON.stringify({ query, courseId }) }),
  chat: (body: ChatRequest) => request<ChatResult>('chat', { method: 'POST', body: JSON.stringify(body) }),
  async chatStream(body: ChatRequest, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch('/api/ai/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? `Chat failed (${response.status})`);
    }
    if (!response.body) throw new Error('The chat stream is empty');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const block = buffer.slice(0, boundary.index).replace(/\r/g, '');
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) continue;
          const parsed = JSON.parse(data) as unknown;
          if (event === 'error') throw new Error((parsed as { error?: string }).error ?? 'Chat failed');
          onEvent(event, parsed);
          if (event === 'done') finished = true;
        }
      }
    } finally { reader.releaseLock(); }
    if (!finished) throw new Error('Chat ended before the answer was complete');
  }
};
export type SourceEvent = Citation[];
