export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LLMProvider {
  readonly capabilities: { provider: string; model: string; supportsStreaming: boolean; maxOutputTokens: number; timeoutMs: number };
  generate(messages: LLMMessage[], signal?: AbortSignal): Promise<string>;
  stream(messages: LLMMessage[], signal?: AbortSignal): AsyncIterable<string>;
}
