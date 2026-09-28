'use client';
import { Menu, Plus } from 'lucide-react';
import Image from 'next/image';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function Header({ isChat, onMenu }: { isChat: boolean; onMenu: () => void }) {
  const { newChat, history } = useChatWorkspace();
  return <header className="site-header">
    <button className="brand" onClick={newChat} aria-label="UniCheatSheet AI home"><span className="brand-mark"><Image src="/logo.webp" alt="" width={25} height={25} priority /></span><span className="brand-name">UniCheatSheet<span className="brand-ai"> AI</span></span></button>
    <div className="header-actions">
      {isChat && <button className="header-text-button" onClick={newChat}><Plus size={17} strokeWidth={1.8} /><span>New chat</span></button>}
      {(isChat || history.length > 0) && <button className="icon-button menu-button" onClick={onMenu} aria-label="Open chat history"><Menu size={20} strokeWidth={1.7} /></button>}
    </div>
  </header>;
}
