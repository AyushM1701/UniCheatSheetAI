'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
import { Header } from '@/components/navigation/Header';
import { ChatSidebar } from '@/components/navigation/ChatSidebar';
import { ChatComposer, type ComposerPrompt } from './ChatComposer';
import { FaqPrompts } from './FaqPrompts';
import { ChatMessage } from './ChatMessage';
import { SourceDrawer } from './SourceDrawer';
import { ThinkingState } from './ThinkingState';
import { WelcomeScreen } from './WelcomeScreen';
export function Workspace({ initialConversationId }: { initialConversationId?: string }) {
  const { messages, status, error, sourceCount, conversationId, openConversation, drawerCitation, openSource, closeSource, navigationTarget } = useChatWorkspace();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [faqPrompt, setFaqPrompt] = useState<ComposerPrompt | null>(null);
  const fillFaqPrompt = (text: string, selectText?: string) => setFaqPrompt((current) => ({ id: (current?.id ?? 0) + 1, text, selectText }));
  const bottom = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  useEffect(() => { if (initialConversationId && initialConversationId !== conversationId && pathname === `/chat/${initialConversationId}` && navigationTarget !== '/') void openConversation(initialConversationId); }, [initialConversationId, conversationId, openConversation, pathname, navigationTarget]);
  useEffect(() => {
    const container = scrollContainer.current;
    if (!container) return;
    const onScroll = () => { followOutput.current = container.scrollHeight - container.scrollTop - container.clientHeight < 160; };
    container.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => { if (followOutput.current) container.scrollTop = container.scrollHeight; });
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => { observer.disconnect(); container.removeEventListener('scroll', onScroll); };
  }, [messages.length > 0]);
  const isChat = Boolean(messages.length || initialConversationId);
  return <div className={`app-shell ${isChat ? 'conversation-shell' : 'landing-shell'}`}>
    <Header isChat={isChat} menuOpen={sidebarOpen} onMenu={() => setSidebarOpen(true)} />
    <ChatSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    {!isChat && <><WelcomeScreen />{error && <p className="landing-error" role="alert">{error}</p>}</>}
    {isChat && <main className="chat-main"><div className="chat-topline"><span className="topline-glow" /> CONVERSATION <span className="topline-divider">/</span> UNI CHEATSHEET</div>
      <div className="chat-scroll" ref={scrollContainer}><div className="chat-thread">
        {messages.map((message) => <ChatMessage key={message.id} message={message} onSource={openSource} />)}
        {(status === 'retrieving' || status === 'generating') && !messages.at(-1)?.content && <ThinkingState status={status} sourceCount={sourceCount} />}
        {error && <p className="chat-error" role="alert">{error}</p>}
        <div ref={bottom} />
      </div></div>
      <div className="chat-composer-dock"><ChatComposer compact prompt={faqPrompt} /><FaqPrompts compact onSelect={fillFaqPrompt} /><p>UniCheatSheet AI can make mistakes. Open a citation to check the original.</p></div>
    </main>}
    <SourceDrawer citation={drawerCitation} onClose={closeSource} />
  </div>;
}
