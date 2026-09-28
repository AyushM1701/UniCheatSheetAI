import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
if (process.env.NODE_ENV === 'production' || process.env.AI_PUBLIC_MODE === 'true') {
  if (process.env.ACCESS_CONTEXT_PROVIDER !== 'jwt') throw new Error('Public AI API requires ACCESS_CONTEXT_PROVIDER=jwt');
  if (!process.env.AI_CORS_ORIGINS?.trim()) throw new Error('Public AI API requires AI_CORS_ORIGINS');
}
const { buildApp } = await import('./app.js');

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
