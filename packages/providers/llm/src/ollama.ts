import type { LLMMessage, LLMProvider } from './provider.js';

export class OllamaProvider implements LLMProvider {
  private readonly baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  private readonly model = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
  private async request(messages: LLMMessage[], stream: boolean, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 60000))]) : AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 60000)),
      body: JSON.stringify({ model: this.model, messages, stream, options: { num_predict: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 2048) } })
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response;
  }
  async generate(messages: LLMMessage[], signal?: AbortSignal): Promise<string> {
    const data = await (await this.request(messages, false, signal)).json() as { message?: { content?: string } };
    return data.message?.content?.trim() ?? '';
  }
  async *stream(messages: LLMMessage[], signal?: AbortSignal): AsyncIterable<string> {
    const body = (await this.request(messages, true, signal)).body;
    if (!body) throw new Error('Ollama returned no stream');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as { message?: { content?: string }; error?: string };
          if (event.error) throw new Error(event.error);
          if (event.message?.content) yield event.message.content;
        }
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
