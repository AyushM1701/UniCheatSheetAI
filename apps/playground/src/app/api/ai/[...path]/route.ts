import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = '[0-9a-fA-F-]{36}';
function permitted(method: string, path: string): boolean {
  if (method === 'GET') return path === 'context' || path === 'me/context' || path === 'courses' || path === 'coverage' || path === 'conversations' || path === 'resources' || path === 'pyqs/questions' || path === 'pyqs/repeated' || /^resources\/[^/]+$/.test(path) || new RegExp(`^(conversations|chunks)/${uuid}$`).test(path) || new RegExp(`^chunks/${uuid}/page-image$`).test(path);
  if (method === 'DELETE') return path === 'me/conversations' || new RegExp(`^conversations/${uuid}$`).test(path);
  return method === 'POST' && ['chat', 'chat/stream', 'retrieve'].includes(path);
}
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const route = path.join('/');
  if (!permitted(request.method, route)) return Response.json({ error: 'Unknown API route' }, { status: 404 });
  const base = (process.env.AI_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  try {
    const authorization = request.headers.get('authorization');
    const upstream = await fetch(`${base}/v1/${route}${request.nextUrl.search}`, { method: request.method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: request.method === 'POST' ? await request.text() : undefined, signal: request.signal, cache: 'no-store' });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error('AI proxy request failed', { requestId, route, error });
    return Response.json({ error: 'AI service is temporarily unavailable.', requestId }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
export const DELETE = forward;
