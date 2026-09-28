'use client';
import Link from 'next/link';
import { MessageSquareText, Plus, X } from 'lucide-react';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { history, conversationId, newChat } = useChatWorkspace();
  const today = new Date().toDateString();
  const recent = history.filter((item) => new Date(item.updatedAt).toDateString() === today);
  const older = history.filter((item) => new Date(item.updatedAt).toDateString() !== today);
  const items = (entries: typeof history) => entries.map((item) => <Link key={item.id} href={`/chat/${item.id}`} onClick={onClose} className={`history-item ${conversationId === item.id ? 'active' : ''}`}><MessageSquareText size={16} strokeWidth={1.6} /><span>{item.title || 'Untitled conversation'}</span></Link>);
  return <>
    {open && <button className="sidebar-scrim" aria-label="Close chat history" onClick={onClose} />}
    <aside className={`chat-sidebar ${open ? 'is-open' : ''}`} aria-label="Chat history">
      <div className="sidebar-top"><span className="sidebar-eyebrow">YOUR WORKSPACE</span><button className="icon-button sidebar-close" onClick={onClose} aria-label="Close history"><X size={18} /></button></div>
      <button className="sidebar-new" onClick={() => { newChat(); onClose(); }}><Plus size={17} /> New chat</button>
      <nav className="history-list">
        {history.length === 0 && <p className="history-empty">Your conversations will appear here.</p>}
        {recent.length > 0 && <><div className="sidebar-section-title">Today</div>{items(recent)}</>}
        {older.length > 0 && <><div className="sidebar-section-title">Earlier</div>{items(older)}</>}
      </nav>
      <div className="sidebar-footer"><span className="status-dot" /> Connected to your indexed material</div>
    </aside>
  </>;
}
