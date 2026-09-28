import { MockLLMProvider } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';
import type { LLMProvider } from './provider.js';
export type { LLMMessage, LLMProvider } from './provider.js';
export { MockLLMProvider, OllamaProvider, GeminiProvider };
const providers = new Map<string, LLMProvider>();
export function getLLMProvider(): LLMProvider {
  const name = process.env.LLM_PROVIDER ?? 'gemini';
  const existing = providers.get(name);
  if (existing) return existing;
  const provider = name === 'mock' ? new MockLLMProvider() : name === 'ollama' ? new OllamaProvider() : name === 'gemini' ? new GeminiProvider() : null;
  if (!provider) throw new Error(`Unsupported LLM_PROVIDER: ${name}`);
  providers.set(name, provider);
  return provider;
}
