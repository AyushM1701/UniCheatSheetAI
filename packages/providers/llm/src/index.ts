import { MockLLMProvider } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';
import type { LLMProvider } from './provider.js';
export type { LLMMessage, LLMProvider } from './provider.js';
export { MockLLMProvider, OllamaProvider, GeminiProvider };
export function getLLMProvider(): LLMProvider {
  const name = process.env.LLM_PROVIDER ?? 'gemini';
  if (name === 'mock') return new MockLLMProvider();
  if (name === 'ollama') return new OllamaProvider();
  if (name === 'gemini') return new GeminiProvider();
  throw new Error(`Unsupported LLM_PROVIDER: ${name}`);
}
