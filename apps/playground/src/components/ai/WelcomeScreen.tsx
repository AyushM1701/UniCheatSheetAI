'use client';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ChatComposer } from './ChatComposer';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function WelcomeScreen() {
  const { semester } = useChatWorkspace();
  const [suggestion, setSuggestion] = useState('');
  const prompts = [
    { label: 'Explain a topic', text: 'Explain normalization for my exam' },
    { label: 'Find PYQs', text: 'Find PYQs on normalization' },
    { label: 'Make revision notes', text: 'Make concise revision notes on normalization' }
  ];
  return <main className="welcome-screen"><div className="welcome-content">
    <div className="welcome-kicker"><span className="kicker-line" /> YOUR ACADEMIC COPILOT <span className="kicker-line" /></div>
    <h1>UniCheatSheet <span>AI</span></h1>
    {semester && <div className="semester-caption">Semester {semester}</div>}
    <p className="welcome-subtitle">Ask your academic material.</p>
    <div className="welcome-composer"><ChatComposer initialText={suggestion} /></div>
    <div className="suggestions" aria-label="Suggested prompts">{prompts.map((prompt) => <button key={prompt.label} onClick={() => setSuggestion(prompt.text)}>{prompt.label}<ArrowUpRight size={14} strokeWidth={1.6} /></button>)}</div>
    <p className="welcome-footnote">Grounded in your notes, tutorials and past papers.</p>
  </div></main>;
}
