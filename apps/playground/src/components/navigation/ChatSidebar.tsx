'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { MessageSquareText, Plus, Trash2, X } from 'lucide-react';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function ChatSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const { history, conversationId, newChat, deleteConversation, coverage } = useChatWorkspace();
  const today = new Date().toDateString();
  const recent = history.filter((item) => new Date(item.updatedAt).toDateString() === today);
  const older = history.filter((item) => new Date(item.updatedAt).toDateString() !== today);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...(drawerRef.current?.querySelectorAll<HTMLElement>('a, button:not([disabled])') ?? [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open, onClose]);
  const items = (entries: typeof history) => entries.map((item) => <div key={item.id} className="history-row"><Link href={`/chat/${item.id}`} onClick={onClose} className={`history-item ${conversationId === item.id ? 'active' : ''}`}><MessageSquareText size={16} strokeWidth={1.6} /><span>{item.title || 'Untitled conversation'}</span></Link><button type="button" className="history-delete" aria-label={`Delete ${item.title || 'untitled conversation'}`} title="Delete conversation" onClick={() => { if (window.confirm('Delete this conversation?')) void deleteConversation(item.id).catch(() => window.alert('Could not delete the conversation.')); }}><Trash2 size={14} /></button></div>);
  return <>
    {open && <button className="sidebar-scrim" aria-label="Close chat history" onClick={onClose} />}
    <aside ref={drawerRef} id="chat-history-drawer" className={`chat-sidebar ${open ? 'is-open' : ''}`} aria-label="Chat history" role="dialog" aria-modal={open} inert={!open}>
      <div className="sidebar-top"><span className="sidebar-eyebrow">YOUR WORKSPACE</span><button className="icon-button sidebar-close" onClick={onClose} aria-label="Close history"><X size={18} /></button></div>
      <button className="sidebar-new" onClick={() => { newChat(); onClose(); }}><Plus size={17} /> New chat</button>
      <nav className="history-list">
        {history.length === 0 && <p className="history-empty">Your conversations will appear here.</p>}
        {recent.length > 0 && <><div className="sidebar-section-title">Today</div>{items(recent)}</>}
        {older.length > 0 && <><div className="sidebar-section-title">Earlier</div>{items(older)}</>}
      </nav>
      <div className="sidebar-footer"><span className="status-dot" /> {coverage.reduce((total, item) => total + item.count, 0)} indexed documents available</div>
    </aside>
  </>;
}
