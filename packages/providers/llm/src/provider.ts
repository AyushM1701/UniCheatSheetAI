export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LLMProvider {
  generate(messages: LLMMessage[]): Promise<string>;
  stream(messages: LLMMessage[]): AsyncIterable<string>;
}
