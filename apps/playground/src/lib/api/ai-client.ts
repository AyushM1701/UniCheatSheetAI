import type { AcademicResource, ChatMode, ChatResult, ChatScope, Citation, Conversation, ConversationSummary, Course, CoverageItem, SourceDetail } from '@/types/chat';
import type { UserAcademicContext } from '@/types/chat';

type TokenProvider = (refresh: boolean) => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;
let apiBase = '/api/ai';
const configurationListeners = new Set<() => void>();
export class AiApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Called by the hosting website after it has authenticated the student. */
export function configureAiClient(options: { tokenProvider?: TokenProvider; apiBaseUrl?: string }) {
  tokenProvider = options.tokenProvider ?? null;
  apiBase = (options.apiBaseUrl ?? '/api/ai').replace(/\/$/, '');
  configurationListeners.forEach((listener) => listener());
}

/** Re-read academic context when the website supplies or replaces its session. */
export function onAiClientConfigured(listener: () => void): () => void {
  configurationListeners.add(listener);
  return () => { configurationListeners.delete(listener); };
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const send = async (refresh: boolean) => {
    const token = await tokenProvider?.(refresh);
    return fetch(`${apiBase}/${path}`, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...init?.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  };
  let response = await send(false);
  if (response.status === 401 && tokenProvider) response = await send(true);
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new AiApiError(body.error ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}
export interface ChatRequest { message: string; conversationId?: string | null; mode?: ChatMode; scope?: Pick<ChatScope, 'semester' | 'courseId' | 'resourceId' | 'documentId' | 'resourceTypes'> }
export const ai = {
  getContext: () => request<UserAcademicContext>('context'),
  getCourses: () => request<Course[]>('courses'),
  getCoverage: () => request<CoverageItem[]>('coverage'),
  getResources: (filters: { courseId?: string; type?: string; category?: 'notes' | 'pyqs' | 'solutions'; page?: number; limit?: number } = {}) => request<{ page: number; limit: number; total: number; resources: AcademicResource[] }>(`resources?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  getRepeatedPyqs: (courseId: string) => request<{ analyzedQuestions: number; truncated: boolean; total: number; repeated: Array<{ text: string; paperCount: number; appearances: Array<{ chunkId: string; paperTitle: string; year: number | null; page: number | null }> }> }>(`pyqs/repeated?courseId=${encodeURIComponent(courseId)}&limit=10`),
  getConversations: () => request<ConversationSummary[]>('conversations'),
  getConversation: (id: string) => request<Conversation>(`conversations/${encodeURIComponent(id)}`),
  getSource: (id: string) => request<SourceDetail>(`chunks/${encodeURIComponent(id)}`),
  retrieve: (query: string, courseId?: string) => request<{ query: string; results: unknown[] }>('retrieve', { method: 'POST', body: JSON.stringify({ query, courseId }) }),
  search: (query: string, courseId?: string) => request<{ query: string; results: unknown[] }>('retrieve', { method: 'POST', body: JSON.stringify({ query, courseId }) }),
  chat: (body: ChatRequest) => request<ChatResult>('chat', { method: 'POST', body: JSON.stringify(body) }),
  async chatStream(body: ChatRequest, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
    const response = await apiFetch('chat/stream', { method: 'POST', body: JSON.stringify(body), signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new AiApiError(data.error ?? `Chat failed (${response.status})`, response.status);
    }
    if (!response.body) throw new Error('The chat stream is empty');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const handleBlock = (block: string) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) return;
      const parsed = JSON.parse(data) as unknown;
      if (event === 'error') throw new Error((parsed as { error?: string }).error ?? 'Chat failed');
      onEvent(event, parsed);
      if (event === 'done') finished = true;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const block = buffer.slice(0, boundary.index).replace(/\r/g, '');
          buffer = buffer.slice(boundary.index + boundary[0].length);
          handleBlock(block);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleBlock(buffer.replace(/\r/g, ''));
    } finally { reader.releaseLock(); }
    if (!finished) throw new Error('Chat ended before the answer was complete');
  }
};
export type SourceEvent = Citation[];
