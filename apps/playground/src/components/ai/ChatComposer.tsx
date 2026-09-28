'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Plus, Sparkles, Square } from 'lucide-react';
import { ScopeSelector } from './ScopeSelector';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function ChatComposer({ compact = false, initialText = '' }: { compact?: boolean; initialText?: string }) {
  const { send, stop, status } = useChatWorkspace();
  const [text, setText] = useState(initialText);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (initialText) { setText(initialText); textarea.current?.focus(); } }, [initialText]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 190)}px`; } }, [text]);
  const busy = status === 'retrieving' || status === 'generating';
  async function submit() { if (text.trim().length < 2 || text.length > 4000 || busy) return; const message = text; setText(''); if (!await send(message)) setText((current) => current || message); }
  return <div className={`composer ${compact ? 'composer-compact' : ''}`}>
    <textarea ref={textarea} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={compact ? 'Ask a follow-up question...' : 'Ask anything about your courses...'} aria-label="Ask UniCheatSheet AI" rows={2} />
    <div className="composer-toolbar">
      <div className="composer-tools"><button className="tool-add" type="button" disabled title="Document uploads are coming later" aria-label="Document uploads coming later"><Plus size={18} strokeWidth={1.7} /></button><ScopeSelector /></div>
      <div className="composer-right"><span className="source-pill" title="Searching indexed UniCheatSheet resources"><Sparkles size={13} /> UniCheatSheet</span>{busy ? <button className="send-button" type="button" onClick={stop} aria-label="Stop response"><Square size={15} fill="currentColor" /></button> : <button className="send-button" type="button" onClick={() => void submit()} disabled={text.trim().length < 2 || text.length > 4000} aria-label="Send message"><ArrowUp size={18} strokeWidth={2.2} /></button>}</div>
    </div>
  </div>;
}
