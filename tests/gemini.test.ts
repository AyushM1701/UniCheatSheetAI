import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../packages/providers/llm/src/gemini.js';

const previousKey = process.env.GEMINI_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
});

describe('Gemini response handling', () => {
  it('keeps the last streamed answer when SSE ends without a blank line', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"first "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"last"}]}}]}',
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )));
    const parts: string[] = [];
    for await (const part of new GeminiProvider().stream([{ role: 'user', content: 'question' }])) parts.push(part);
    expect(parts).toEqual(['first ', 'last']);
  });
});
