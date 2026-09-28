'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import type { Citation, UIMessage } from '@/types/chat';
import { SourceCard } from './SourceCard';
export function ChatMessage({ message, onSource }: { message: UIMessage; onSource: (citation: Citation) => void }) {
  const user = message.role === 'user';
  const rendered = message.content.replace(/\[S(\d+)\]/g, '[S$1](#source-S$1)');
  return <article className={`chat-message ${user ? 'chat-message-user' : 'chat-message-ai'}`}>
    <div className="message-heading">{user ? <span className="user-avatar">Y</span> : <span className="ai-avatar"><Sparkles size={15} strokeWidth={1.8} /></span>}<span>{user ? 'You' : 'UniCheatSheet AI'}</span></div>
    <div className="message-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
      const match = href?.match(/^#source-(S\d+)$/);
      if (match) { const citation = message.citations.find((item) => item.id === match[1]); return citation ? <button className="inline-citation" onClick={() => onSource(citation)}>{children}</button> : <span>{children}</span>; }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    } }}>{rendered}</ReactMarkdown></div>
    {!user && message.citations.length > 0 && <div className="message-sources"><div className="sources-heading">SOURCES <span>{message.citations.length}</span></div><div className="source-cards">{message.citations.map((citation) => <SourceCard key={citation.id} citation={citation} onClick={() => onSource(citation)} />)}</div></div>}
  </article>;
}
