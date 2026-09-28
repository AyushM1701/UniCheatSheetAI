import type { LLMMessage, LLMProvider } from './provider.js';

/** Deterministic extractive fallback for local development; it does not generate new facts. */
export class MockLLMProvider implements LLMProvider {
  readonly capabilities = { provider: 'mock', model: 'extractive-fixture', supportsStreaming: true, maxOutputTokens: 700, timeoutMs: 0 };
  async generate(messages: LLMMessage[]): Promise<string> {
    const current = messages.at(-1)?.content ?? '';
    const question = current.split('\nUSER QUESTION:\n').at(-1) ?? current;
    if (/^(hi|hello|hey)[!.\s]*$/i.test(question.trim())) return 'Hi! Ask me about your UniCheatSheet course material.';
    const context = `${messages.find((message) => message.role === 'system')?.content ?? ''}\n${current}`;
    const source = context.match(/\[S1\][\s\S]*?Content:\s*([\s\S]*?)(?=\n\[S\d+\]|\nEND SOURCES|$)/);
    if (!source?.[1]) return 'I could not find relevant information in the indexed UniCheatSheet material.';
    const excerpt = source[1].trim().replace(/\s+/g, ' ').slice(0, 700);
    if (context.includes('INTENT: practice_generation')) return `Generated practice question (not a PYQ): Explain the concept described in this passage and give one example. [S1]\nSource excerpt: ${excerpt.slice(0, 300)} [S1]`;
    return `${excerpt} [S1]`;
  }
  async *stream(messages: LLMMessage[]): AsyncIterable<string> {
    const answer = await this.generate(messages);
    for (const part of answer.match(/\S+\s*/g) ?? []) yield part;
  }
}
