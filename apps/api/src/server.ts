import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (process.env.NODE_ENV === 'production' || process.env.AI_PUBLIC_MODE === 'true') {
  if (process.env.ACCESS_CONTEXT_PROVIDER !== 'jwt') throw new Error('Public AI API requires ACCESS_CONTEXT_PROVIDER=jwt');
  if (!process.env.AI_CORS_ORIGINS?.trim()) throw new Error('Public AI API requires AI_CORS_ORIGINS');
  if (!process.env.DATABASE_URL) throw new Error('Public AI API requires DATABASE_URL');
  if ((process.env.LLM_PROVIDER ?? 'gemini') === 'gemini' && !process.env.GEMINI_API_KEY) throw new Error('Public AI API requires GEMINI_API_KEY for Gemini');
  if ((process.env.EMBEDDING_PROVIDER ?? 'local') !== 'local') throw new Error('Public AI API requires the same local embedding model used during indexing');
}
const { buildApp } = await import('./app.js');

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
