'use client';
import type { ChatMode } from '@/types/chat';
import { useChatWorkspace } from '@/hooks/useChatWorkspace';

type FaqPrompt = { label: string; prompt: string; mode: ChatMode; selectText?: string };

export function FaqPrompts({ onSelect, compact = false }: { onSelect: (prompt: string, selectText?: string) => void; compact?: boolean }) {
  const { courses, coverage, scope, setScope, setMode } = useChatWorkspace();
  const available = coverage.filter((item) => !scope.courseId || item.courseId === scope.courseId);
  const hasMaterial = available.some((item) => item.count > 0);
  const hasNotes = available.some((item) => ['lecture', 'book', 'syllabus'].includes(item.type) && item.count > 0);
  const hasPyqs = available.some((item) => item.type === 'pyq' && item.count > 0);
  if (!courses.length) return null;

  const prompts: FaqPrompt[] = [
    ...(hasMaterial ? [
      { label: 'Explain a topic', prompt: 'Explain [topic] step by step using my indexed course material. Include a simple example and cite the sources.', mode: 'auto' as const, selectText: '[topic]' },
      { label: 'Solve a question', prompt: 'Solve [paste a question here] step by step. Use my indexed course material when it supports the answer.', mode: 'auto' as const, selectText: '[paste a question here]' }
    ] : []),
    ...(hasNotes ? [{ label: 'Revise my notes', prompt: 'Summarize my indexed notes on [topic] into a short revision sheet with citations.', mode: 'notes' as const, selectText: '[topic]' }] : []),
    ...(hasMaterial ? [{ label: 'Make a practice quiz', prompt: 'Generate five practice questions on [topic] based on my indexed course material. Clearly label them as generated practice.', mode: 'practice' as const, selectText: '[topic]' }] : []),
    ...(hasPyqs ? [{ label: 'Find real PYQs', prompt: 'Give me some real past-paper questions from this course.', mode: 'pyqs' as const }] : []),
    ...(!hasMaterial ? [{ label: 'What is available?', prompt: 'How many indexed documents are available?', mode: 'auto' as const }] : [])
  ];

  return <section className={`faq-prompts ${compact ? 'faq-prompts-compact' : ''}`} aria-label="Frequently asked questions">
    <div className="faq-heading"><span>FAQ</span><small>Tap a question to fill the chat box</small></div>
    <div className="faq-list">{prompts.map((item) => <button key={item.label} type="button" onClick={() => {
      setScope({ sources: ['unicheatsheet'], courseId: scope.courseId });
      setMode(item.mode);
      onSelect(item.prompt, item.selectText);
    }}>{item.label}</button>)}</div>
  </section>;
}
