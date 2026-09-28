import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = '[0-9a-fA-F-]{36}';
function permitted(method: string, path: string): boolean {
  if (method === 'GET') return path === 'context' || path === 'me/context' || path === 'courses' || path === 'conversations' || new RegExp(`^(conversations|chunks)/${uuid}$`).test(path);
  return method === 'POST' && ['chat', 'chat/stream', 'retrieve'].includes(path);
}
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const route = path.join('/');
  if (!permitted(request.method, route)) return Response.json({ error: 'Unknown API route' }, { status: 404 });
  const base = (process.env.AI_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  try {
    const authorization = request.headers.get('authorization');
    const upstream = await fetch(`${base}/v1/${route}`, { method: request.method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: request.method === 'POST' ? await request.text() : undefined, cache: 'no-store' });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'AI backend is unavailable. Start it with pnpm dev.' }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
