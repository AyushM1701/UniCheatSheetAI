'use client';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ChatComposer } from './ChatComposer';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';
export function WelcomeScreen() {
  const { semester, scope, coverage } = useChatWorkspace();
  const [suggestion, setSuggestion] = useState('');
  const available = coverage.filter((item) => !scope.courseId || item.courseId === scope.courseId);
  const count = available.reduce((total, item) => total + item.count, 0);
  const papers = available.filter((item) => item.type === 'pyq').reduce((total, item) => total + item.count, 0);
  const prompts = count ? [
    { label: 'Explain a topic', text: 'Explain a topic from my indexed course material' },
    ...(papers ? [{ label: 'Find PYQs', text: 'Find indexed previous year questions for my course' }] : []),
    { label: 'Make revision notes', text: 'Make concise revision notes from my indexed course material' }
  ] : [];
  return <main className="welcome-screen"><div className="welcome-content">
    <div className="welcome-kicker"><span className="kicker-line" /> YOUR ACADEMIC COPILOT <span className="kicker-line" /></div>
    <h1>UniCheatSheet <span>AI</span></h1>
    {semester && <div className="semester-caption">Semester {semester}</div>}
    <p className="welcome-subtitle">Ask your academic material.</p>
    <div className="welcome-composer"><ChatComposer initialText={suggestion} /></div>
    {prompts.length > 0 && <div className="suggestions" aria-label="Suggested prompts">{prompts.map((prompt) => <button key={prompt.label} onClick={() => setSuggestion(prompt.text)}>{prompt.label}<ArrowUpRight size={14} strokeWidth={1.6} /></button>)}</div>}
    <p className="welcome-footnote">{count ? `${count} indexed ${count === 1 ? 'document' : 'documents'} available${papers ? `, including ${papers} past ${papers === 1 ? 'paper' : 'papers'}` : ''}.` : 'Choose a course and ask about its indexed material.'}</p>
  </div></main>;
}
