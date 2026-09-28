import { describe, expect, it } from 'vitest';
import { routeQuery, validateCitations } from '../packages/ai-core/src/index.js';
import { buildPrompt } from '../packages/ai-core/src/prompt-builder.js';

describe('grounded chat rules', () => {
  it('distinguishes PYQ lookup from generated practice', () => {
    expect(routeQuery('Give me PYQs on normalization')).toBe('resource_search');
    expect(routeQuery('Generate 10 practice questions on normalization')).toBe('practice_generation');
    expect(routeQuery('How many DBMS PYQs are available?')).toBe('database_query');
    expect(routeQuery('Hi')).toBe('general_chat');
  });
  it('accepts only citations assigned to retrieved chunks', () => {
    const source = { id: 'S1', hit: {} as never, citation: { id: 'S1', documentId: 'doc-1', chunkId: 'chunk-1', documentTitle: 'Real Notes', courseId: 'dbms', page: 7, pageStart: 7, pageEnd: 7, sourceUrl: 'https://drive.google.com/file/d/real/view' } };
    const checked = validateCitations('A fact [S1]. Fake [S9] https://invented.example', [source]);
    expect(checked.answer).toContain('[S1]');
    expect(checked.answer).not.toContain('[S9]');
    expect(checked.answer).not.toContain('invented.example');
    expect(checked.citations).toEqual([source.citation]);
  });
  it('places source content and recent messages in the prompt', () => {
    const prompt = buildPrompt({ message: 'Explain it', courseName: 'DBMS', intent: 'academic_rag', history: [{ role: 'user', content: 'Earlier question' }], sources: [] });
    expect(prompt[0]?.content).toContain('Never invent a source');
    expect(prompt[1]).toEqual({ role: 'user', content: 'Earlier question' });
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'Explain it' });
  });
});
