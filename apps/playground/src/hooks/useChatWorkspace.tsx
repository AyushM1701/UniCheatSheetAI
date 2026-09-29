'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AiApiError, ai, onAiClientConfigured } from '@/lib/api/ai-client';
import type { ChatMode, ChatResult, ChatScope, ChatStatus, Citation, ConversationSummary, CoverageItem, UIMessage, UserAcademicContext } from '@/types/chat';

type WorkspaceContext = {
  messages: UIMessage[]; status: ChatStatus; error: string | null; scope: ChatScope; setScope: (scope: ChatScope) => void; mode: ChatMode; setMode: (mode: ChatMode) => void;
  courses: UserAcademicContext['allowedCourses']; semester: number | null; history: ConversationSummary[]; conversationId: string | null; sourceCount: number;
  coverage: CoverageItem[];
  send: (message: string) => Promise<boolean>; stop: () => void; openConversation: (id: string) => Promise<void>; newChat: () => void; refreshHistory: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
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
  const [mode, setMode] = useState<ChatMode>('auto');
  const [courses, setCourses] = useState<UserAcademicContext['allowedCourses']>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const defaultCourse = useRef<string | null>(null);
  const academicContextKey = useRef<string | null>(null);
  const contextRequest = useRef(0);
  const lastContextRefresh = useRef(0);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [drawerCitation, setDrawerCitation] = useState<Citation | null>(null);
  const closeSource = useCallback(() => setDrawerCitation(null), []);
  const active = useRef(false);
  const requestVersion = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const pendingUserId = useRef<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  useEffect(() => { if (pathname === navigationTarget) setNavigationTarget(null); }, [pathname, navigationTarget]);
  const clearSession = useCallback(() => {
    ++requestVersion.current;
    activeController.current?.abort();
    activeController.current = null;
    active.current = false;
    pendingUserId.current = null;
    defaultCourse.current = null;
    setMessages([]); setConversationId(null); setScope({ sources: ['unicheatsheet'] }); setMode('auto');
    setHistory([]); setCoverage([]); setSourceCount(0); setDrawerCitation(null);
    setStatus('idle'); setNavigationTarget('/');
    router.replace('/');
  }, [router]);
  const loadAcademicContext = useCallback(async () => {
    const version = ++contextRequest.current;
    try {
      const context = await ai.getContext();
      if (version !== contextRequest.current) return;
      const key = JSON.stringify([context.accountKey, context.semester, [...context.allowedCourses.map((course) => course.id)].sort()]);
      const initializeDefault = academicContextKey.current === null || academicContextKey.current !== key;
      if (academicContextKey.current !== null && academicContextKey.current !== key) clearSession();
      academicContextKey.current = key;
      lastContextRefresh.current = Date.now();
      setSemester(context.semester);
      setCourses(context.allowedCourses);
      defaultCourse.current = context.currentCourseId ?? null;
      setScope((current) => current.courseId && context.allowedCourses.some((course) => course.id === current.courseId)
        ? current
        : current.courseId || initializeDefault
          ? { sources: ['unicheatsheet'], courseId: context.currentCourseId ?? undefined }
          : current);
      setError(null);
      const [conversations, sourceCoverage] = await Promise.allSettled([ai.getConversations(), ai.getCoverage()]);
      if (version !== contextRequest.current) return;
      if (conversations.status === 'fulfilled') setHistory(conversations.value);
      if (sourceCoverage.status === 'fulfilled') setCoverage(sourceCoverage.value);
    } catch (cause) {
      if (version !== contextRequest.current) return;
      if (cause instanceof AiApiError && (cause.status === 401 || cause.status === 403)) {
        clearSession(); academicContextKey.current = null;
        setSemester(null); setCourses([]);
      }
      setError(cause instanceof Error ? cause.message : 'Could not load course access');
    }
  }, [clearSession]);
  useEffect(() => { void loadAcademicContext(); }, [loadAcademicContext]);
  useEffect(() => {
    const unsubscribe = onAiClientConfigured(() => {
      ++contextRequest.current;
      clearSession(); academicContextKey.current = null;
      setSemester(null); setCourses([]); setError(null);
      void loadAcademicContext();
    });
    const onFocus = () => { if (Date.now() - lastContextRefresh.current > 60_000) void loadAcademicContext(); };
    window.addEventListener('focus', onFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); };
  }, [clearSession, loadAcademicContext]);
  const refreshHistory = useCallback(async () => { setHistory(await ai.getConversations()); }, []);
  const openConversation = useCallback(async (id: string) => {
    if (id === conversationId && messages.length) return;
    const version = ++requestVersion.current;
    activeController.current?.abort();
    active.current = false;
    pendingUserId.current = null;
    setStatus('retrieving'); setError(null);
    try {
      const conversation = await ai.getConversation(id);
      if (version !== requestVersion.current) return;
      setScope({ courseId: conversation.courseId ?? undefined, sources: ['unicheatsheet'] }); setMode('auto');
      setMessages(conversation.messages.filter((item): item is typeof item & { role: 'user' | 'assistant' } => item.role === 'user' || item.role === 'assistant').map((item) => ({ id: item.id, role: item.role, content: item.content, citations: Array.isArray(item.citations) ? item.citations : [], provenance: item.role === 'assistant' ? /I could not find relevant|I could not find matching indexed/i.test(item.content) ? 'insufficient' : Array.isArray(item.citations) && item.citations.length ? /^Here are \d+ questions from your indexed past papers:/.test(item.content) ? 'grounded' : 'mixed' : 'general' : undefined })));
      setConversationId(id); setStatus('complete'); setSourceCount(0);
    } catch (cause) { if (version === requestVersion.current) { setMessages([]); setConversationId(null); setStatus('error'); setError(cause instanceof Error ? cause.message : 'Could not open conversation'); } }
  }, [conversationId, messages.length]);
  const newChat = useCallback(() => { ++requestVersion.current; activeController.current?.abort(); active.current = false; pendingUserId.current = null; setNavigationTarget('/'); setMessages([]); setConversationId(null); setScope({ courseId: defaultCourse.current ?? undefined, sources: ['unicheatsheet'] }); setMode('auto'); setStatus('idle'); setError(null); setSourceCount(0); setDrawerCitation(null); router.push('/'); }, [router]);
  const deleteConversation = useCallback(async (id: string) => {
    await ai.deleteConversation(id);
    setHistory((current) => current.filter((item) => item.id !== id));
    if (conversationId === id) newChat();
  }, [conversationId, newChat]);
  const stop = useCallback(() => { ++requestVersion.current; activeController.current?.abort(); activeController.current = null; active.current = false; const id = pendingUserId.current; pendingUserId.current = null; setMessages((current) => current.filter((item) => !item.pending && item.id !== id)); setStatus('idle'); setError(null); }, []);
  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (message.length < 2 || message.length > 4000 || active.current) return false;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    activeController.current = controller;
    active.current = true; setError(null); setStatus('retrieving'); setSourceCount(0);
    const userId = crypto.randomUUID(); const assistantId = crypto.randomUUID();
    pendingUserId.current = userId;
    setMessages((current) => [...current, { id: userId, role: 'user', content: message, citations: [] }, { id: assistantId, role: 'assistant', content: '', citations: [], pending: true }]);
    let completed = false;
    try {
      await ai.chatStream({ message, conversationId, mode, scope: { ...(scope.courseId ? { courseId: scope.courseId } : {}), ...(scope.semester ? { semester: scope.semester } : {}), ...(scope.resourceId ? { resourceId: scope.resourceId } : {}), ...(scope.documentId ? { documentId: scope.documentId } : {}), ...(scope.resourceTypes ? { resourceTypes: scope.resourceTypes } : {}) } }, (event, data) => {
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
          pendingUserId.current = null;
          setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: result.answer, citations: result.citations, provenance: result.metadata.provenance, pending: false } : item));
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
      pendingUserId.current = null;
      setMessages((current) => current.filter((item) => item.id !== assistantId && item.id !== userId));
      return false;
    } finally { if (version === requestVersion.current) { active.current = false; activeController.current = null; } }
  }, [conversationId, mode, router, scope]);
  return <Context.Provider value={{ messages, status, error, scope, setScope, mode, setMode, courses, semester, history, coverage, conversationId, sourceCount, send, stop, openConversation, newChat, refreshHistory, deleteConversation, drawerCitation, openSource: setDrawerCitation, closeSource, navigationTarget }}>{children}</Context.Provider>;
}
