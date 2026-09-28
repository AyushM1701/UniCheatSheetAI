import type { LLMMessage, LLMProvider } from './provider.js';

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
function responseText(value: GeminiResponse): string { return value.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''; }
function streamText(event: string): string {
  const data = event.replace(/\r/g, '').split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!data || data === '[DONE]') return '';
  const parsed = JSON.parse(data) as GeminiResponse;
  if (parsed.error?.message) throw new Error(parsed.error.message);
  return responseText(parsed);
}

export class GeminiProvider implements LLMProvider {
  private readonly model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
  readonly capabilities = { provider: 'gemini', model: this.model, supportsStreaming: true, maxOutputTokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 2048), timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000) };
  private failures = 0;
  private unavailableUntil = 0;
  private async request(messages: LLMMessage[], stream: boolean, signal?: AbortSignal): Promise<Response> {
    if (Date.now() < this.unavailableUntil) throw new Error('Gemini is temporarily unavailable. Browse the indexed resources and try chat shortly.');
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is missing; set it in .env');
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    const contents = messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const deadline = Date.now() + Number(process.env.LLM_TIMEOUT_MS ?? 60000);
    for (let attempt = 0; attempt < 3; attempt++) {
      let shouldRetry = true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Gemini request deadline exceeded');
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
          body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 2048) } })
        });
        if (response.ok) { this.failures = 0; return response; }
        const retryable = [429, 500, 502, 503, 504].includes(response.status);
        const description = (await response.text()).slice(0, 300);
        if (!retryable || attempt === 2) { shouldRetry = retryable; throw new Error(`Gemini returned ${response.status}: ${description}`); }
      } catch (error) {
        if (signal?.aborted || attempt === 2 || !shouldRetry) {
          if (shouldRetry) {
            this.failures++;
            if (this.failures >= 3) this.unavailableUntil = Date.now() + 30_000;
          }
          throw error;
        }
      }
      const delay = Math.min(250 * 2 ** attempt + Math.random() * 150, Math.max(0, deadline - Date.now()));
      if (delay) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }
    throw new Error('Gemini retry limit reached');
  }
  async generate(messages: LLMMessage[], signal?: AbortSignal): Promise<string> {
    const result = await (await this.request(messages, false, signal)).json() as GeminiResponse;
    const text = responseText(result).trim();
    if (!text) throw new Error('Gemini returned an empty answer');
    return text;
  }
  async *stream(messages: LLMMessage[], signal?: AbortSignal): AsyncIterable<string> {
    const body = (await this.request(messages, true, signal)).body;
    if (!body) throw new Error('Gemini returned no stream');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
          const text = streamText(event);
          if (text) yield text;
        }
      }
      buffer += decoder.decode();
      const final = streamText(buffer);
      if (final) yield final;
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
