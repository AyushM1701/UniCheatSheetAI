'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, X } from 'lucide-react';
import Image from 'next/image';
import { ScopeSelector } from './ScopeSelector';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function ChatComposer({ compact = false, initialText = '' }: { compact?: boolean; initialText?: string }) {
  const { send, stop, status, scope, setScope, mode, setMode } = useChatWorkspace();
  const [text, setText] = useState(initialText);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (initialText) { setText(initialText); textarea.current?.focus(); } }, [initialText]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 190)}px`; } }, [text]);
  const busy = status === 'retrieving' || status === 'generating';
  async function submit() { if (text.trim().length < 2 || text.length > 4000 || busy) return; const message = text; setText(''); if (!await send(message)) setText((current) => current || message); }
  return <div className={`composer ${compact ? 'composer-compact' : ''}`}>
    <textarea ref={textarea} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={compact ? 'Ask a follow-up question...' : 'Ask anything about your courses...'} aria-label="Ask UniCheatSheet AI" rows={2} />
    <div className="composer-toolbar">
      <div className="composer-tools"><ScopeSelector />{scope.resourceId && <button className="composer-scope-pill" type="button" title="Clear document scope" onClick={() => setScope({ ...scope, resourceId: undefined, documentId: undefined })}>This document <X size={12} /></button>}{mode !== 'auto' && <button className="composer-scope-pill" type="button" title="Clear material filter" onClick={() => setMode('auto')}>{mode === 'pyqs' ? 'PYQs' : mode === 'practice' ? 'Practice' : mode === 'notes' ? 'Notes' : 'Solutions'} <X size={12} /></button>}</div>
      <div className="composer-right"><span className="source-pill" title="Searching indexed UniCheatSheet resources"><Image src="/logo.webp" alt="" width={25} height={25} /> UniCheatSheet</span>{busy ? <button className="send-button" type="button" onClick={stop} aria-label="Stop response"><Square size={15} fill="currentColor" /></button> : <button className="send-button" type="button" onClick={() => void submit()} disabled={text.trim().length < 2 || text.length > 4000} aria-label="Send message"><ArrowUp size={18} strokeWidth={2.2} /></button>}</div>
    </div>
  </div>;
}
