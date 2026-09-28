'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ai } from '@/lib/api/ai-client';
import type { ChatResult, ChatScope, ChatStatus, Citation, ConversationSummary, Course, UIMessage } from '@/types/chat';

type WorkspaceContext = {
  messages: UIMessage[]; status: ChatStatus; error: string | null; scope: ChatScope; setScope: (scope: ChatScope) => void;
  courses: Course[]; semester: number | null; history: ConversationSummary[]; conversationId: string | null; sourceCount: number;
  send: (message: string) => Promise<boolean>; openConversation: (id: string) => Promise<void>; newChat: () => void; refreshHistory: () => Promise<void>;
  drawerCitation: Citation | null; openSource: (citation: Citation) => void; closeSource: () => void;
  navigationTarget: string | null;
};
const Context = createContext<WorkspaceContext | null>(null);
export function useChatWorkspace(): WorkspaceContext { const value = useContext(Context); if (!value) throw new Error('ChatProvider is missing'); return value; }

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ChatScope>({ sources: ['unicheatsheet'] });
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const defaultCourse = useRef<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [drawerCitation, setDrawerCitation] = useState<Citation | null>(null);
  const active = useRef(false);
  const requestVersion = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  useEffect(() => { if (pathname === navigationTarget) setNavigationTarget(null); }, [pathname, navigationTarget]);
  useEffect(() => {
    ai.getContext().then((context) => {
      setCourses(context.allowedCourses.map((course) => ({ ...course, semester: context.semester, aliases: [] })));
      setSemester(context.semester);
      defaultCourse.current = context.currentCourseId ?? null;
      if (context.currentCourseId && pathname === '/') setScope((current) => current.courseId ? current : { courseId: context.currentCourseId ?? undefined, sources: ['unicheatsheet'] });
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load course access'));
    ai.getConversations().then(setHistory).catch(() => undefined);
  }, [pathname]);
  const refreshHistory = useCallback(async () => { setHistory(await ai.getConversations()); }, []);
  const openConversation = useCallback(async (id: string) => {
    if (id === conversationId && messages.length) return;
    const version = ++requestVersion.current;
    activeController.current?.abort();
    active.current = false;
    setStatus('retrieving'); setError(null);
    try {
      const conversation = await ai.getConversation(id);
      if (version !== requestVersion.current) return;
      setScope({ courseId: conversation.courseId ?? undefined, sources: ['unicheatsheet'] });
      setMessages(conversation.messages.filter((item): item is typeof item & { role: 'user' | 'assistant' } => item.role === 'user' || item.role === 'assistant').map((item) => ({ id: item.id, role: item.role, content: item.content, citations: Array.isArray(item.citations) ? item.citations : [] })));
      setConversationId(id); setStatus('complete'); setSourceCount(0);
    } catch (cause) { if (version === requestVersion.current) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'Could not open conversation'); } }
  }, [conversationId, messages.length]);
  const newChat = useCallback(() => { ++requestVersion.current; activeController.current?.abort(); active.current = false; setNavigationTarget('/'); setMessages([]); setConversationId(null); setScope({ courseId: defaultCourse.current ?? undefined, sources: ['unicheatsheet'] }); setStatus('idle'); setError(null); setSourceCount(0); setDrawerCitation(null); router.push('/'); }, [router]);
  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (message.length < 2 || message.length > 4000 || active.current) return false;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    activeController.current = controller;
    active.current = true; setError(null); setStatus('retrieving'); setSourceCount(0);
    const userId = crypto.randomUUID(); const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: userId, role: 'user', content: message, citations: [] }, { id: assistantId, role: 'assistant', content: '', citations: [], pending: true }]);
    let completed = false;
    try {
      await ai.chatStream({ message, conversationId, scope: { ...(scope.courseId ? { courseId: scope.courseId } : {}), ...(scope.semester ? { semester: scope.semester } : {}) } }, (event, data) => {
        if (version !== requestVersion.current) return;
        if (event === 'status') setStatus((data as { status: ChatStatus }).status);
        if (event === 'sources') setSourceCount((data as Citation[]).length);
        if (event === 'token') {
          const token = (data as { text: string }).text;
          setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + token } : item));
        }
        if (event === 'done') {
          const result = data as ChatResult;
          completed = true;
          setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: result.answer, citations: result.citations, pending: false } : item));
          setConversationId(result.conversationId); setStatus('complete');
          router.replace(`/chat/${result.conversationId}`);
          ai.getConversations().then(setHistory).catch(() => undefined);
        }
      }, controller.signal);
      if (version !== requestVersion.current) return false;
      if (!completed) throw new Error('The answer was interrupted');
      return true;
    } catch (cause) {
      if (version !== requestVersion.current) return false;
      const message = cause instanceof Error ? cause.message : 'Could not send message';
      setError(message); setStatus('error');
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: message, pending: false } : item));
      return false;
    } finally { if (version === requestVersion.current) { active.current = false; activeController.current = null; } }
  }, [conversationId, router, scope]);
  return <Context.Provider value={{ messages, status, error, scope, setScope, courses, semester, history, conversationId, sourceCount, send, openConversation, newChat, refreshHistory, drawerCitation, openSource: setDrawerCitation, closeSource: () => setDrawerCitation(null), navigationTarget }}>{children}</Context.Provider>;
}
