'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import Image from 'next/image';
import { UserRound } from 'lucide-react';
import type { Citation, UIMessage } from '@/types/chat';
import { SourceCard } from './SourceCard';
export function ChatMessage({ message, onSource }: { message: UIMessage; onSource: (citation: Citation) => void }) {
  const user = message.role === 'user';
  const rendered = message.content.replace(/\[S(\d+)\]/g, '[S$1](#source-S$1)');
  return <article className={`chat-message ${user ? 'chat-message-user' : 'chat-message-ai'}`}>
    <div className="message-heading">{user ? <span className="user-avatar"><UserRound size={15} aria-hidden="true" /></span> : <span className="ai-avatar"><Image src="/logo.webp" alt="" width={25} height={25} /></span>}<span>{user ? 'You' : 'UniCheatSheet AI'}</span>{!user && !message.pending && message.provenance && <span className={`provenance-badge provenance-${message.provenance}`}>{message.provenance === 'grounded' ? 'Indexed source result' : message.provenance === 'mixed' ? 'Sources + AI explanation' : message.provenance === 'insufficient' ? 'Source gap' : 'General explanation'}</span>}</div>
    <div className="message-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: ({ href, children }) => {
      const match = href?.match(/^#source-(S\d+)$/);
      if (match) { const citation = message.citations.find((item) => item.id === match[1]); return citation ? <button className="inline-citation" data-source-chunk-id={citation.chunkId} onClick={() => onSource(citation)}>{children}</button> : <span>{children}</span>; }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    } }}>{rendered}</ReactMarkdown></div>
    {!user && message.citations.length > 0 && <div className="message-sources"><div className="sources-heading">SOURCES <span>{message.citations.length}</span></div><div className="source-cards">{message.citations.map((citation) => <SourceCard key={citation.id} citation={citation} onClick={() => onSource(citation)} />)}</div></div>}
  </article>;
}
