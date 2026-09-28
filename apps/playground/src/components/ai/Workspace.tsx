'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
import { Header } from '@/components/navigation/Header';
import { ChatSidebar } from '@/components/navigation/ChatSidebar';
import { ChatComposer } from './ChatComposer';
import { ChatMessage } from './ChatMessage';
import { SourceDrawer } from './SourceDrawer';
import { ThinkingState } from './ThinkingState';
import { WelcomeScreen } from './WelcomeScreen';
export function Workspace({ initialConversationId }: { initialConversationId?: string }) {
  const { messages, status, error, sourceCount, conversationId, openConversation, drawerCitation, openSource, closeSource, navigationTarget } = useChatWorkspace();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { if (initialConversationId && initialConversationId !== conversationId && pathname === `/chat/${initialConversationId}` && navigationTarget !== '/') void openConversation(initialConversationId); }, [initialConversationId, conversationId, openConversation, pathname, navigationTarget]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'auto', block: 'end' }); }, [messages.length, status]);
  const isChat = Boolean(messages.length || initialConversationId);
  return <div className={`app-shell ${isChat ? 'conversation-shell' : 'landing-shell'}`}>
    <Header isChat={isChat} onMenu={() => setSidebarOpen(true)} />
    <ChatSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    {!isChat && <><WelcomeScreen />{error && <p className="landing-error" role="alert">{error}</p>}</>}
    {isChat && <main className="chat-main"><div className="chat-topline"><span className="topline-glow" /> CONVERSATION <span className="topline-divider">/</span> UNI CHEATSHEET</div>
      <div className="chat-scroll"><div className="chat-thread">
        {messages.map((message) => <ChatMessage key={message.id} message={message} onSource={openSource} />)}
        {(status === 'retrieving' || status === 'generating') && !messages.at(-1)?.content && <ThinkingState status={status} sourceCount={sourceCount} />}
        {error && <p className="chat-error" role="alert">{error}</p>}
        <div ref={bottom} />
      </div></div>
      <div className="chat-composer-dock"><ChatComposer compact /><p>UniCheatSheet AI can make mistakes. Open a citation to check the original.</p></div>
    </main>}
    <SourceDrawer citation={drawerCitation} onClose={closeSource} />
  </div>;
}
