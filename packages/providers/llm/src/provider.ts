export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LLMProvider {
  generate(messages: LLMMessage[], signal?: AbortSignal): Promise<string>;
  stream(messages: LLMMessage[], signal?: AbortSignal): AsyncIterable<string>;
}
