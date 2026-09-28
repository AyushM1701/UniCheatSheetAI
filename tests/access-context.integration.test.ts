import 'dotenv/config';
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../packages/database/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
import { JwtAccessContextProvider } from '../apps/api/src/access-context.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const old = Object.fromEntries(['ACCESS_CONTEXT_PROVIDER', 'AI_JWT_PUBLIC_KEY', 'AI_JWT_ISSUER', 'AI_JWT_AUDIENCE', 'AI_CORS_ORIGINS', 'LLM_PROVIDER'].map((key) => [key, process.env[key]]));
process.env.ACCESS_CONTEXT_PROVIDER = 'jwt';
process.env.AI_JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.AI_JWT_ISSUER = 'https://site.example';
process.env.AI_JWT_AUDIENCE = 'unicheatsheet-ai';
process.env.AI_CORS_ORIGINS = 'https://site.example';
process.env.LLM_PROVIDER = 'mock';

function token(sub: string, courses = ['dbms'], expiresIn = 600, semester = 3): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, iss: 'https://site.example', aud: 'unicheatsheet-ai', semester, courses, iat: now, exp: now + expiresIn })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('signed AI access', () => {
  const app = buildApp(new JwtAccessContextProvider());
  const created: string[] = [];
  afterAll(async () => {
    await app.close();
    await db.conversation.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
    for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });

  it('requires a valid short-lived signed token and restricts browser origins', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me/context' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('alice', ['dbms'], -1)}` } })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('alice')}`, origin: 'https://site.example' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://site.example');
    expect(response.json().allowedCourses[0].id).toBe('dbms');
    expect(response.json().semester).toBe(3);
    expect(response.json().accountKey).toMatch(/^[0-9a-f]{64}$/);
    const bobContext = await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('bob')}` } });
    expect(bobContext.json().accountKey).not.toBe(response.json().accountKey);
    const unknownCourse = await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('alice', ['unknown-course-id'])}` } });
    expect(unknownCourse.statusCode).toBe(401);
    const fifthSemester = await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('alice', ['dbms'], 600, 5)}` } });
    expect(fifthSemester.statusCode).toBe(200);
    expect(fifthSemester.json().semester).toBe(5);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/chat/stream', headers: { origin: 'https://site.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://site.example');
    const otherOrigin = await app.inject({ method: 'GET', url: '/v1/me/context', headers: { authorization: `Bearer ${token('alice')}`, origin: 'https://other.example' } });
    expect(otherOrigin.headers['access-control-allow-origin']).toBeUndefined();
    const stream = await app.inject({ method: 'POST', url: '/v1/chat/stream', headers: { authorization: `Bearer ${token('alice')}`, origin: 'https://site.example' }, payload: { message: 'Hi', scope: { courseId: 'dbms' } } });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['access-control-allow-origin']).toBe('https://site.example');
    const done = stream.payload.match(/event: done\ndata: ([^\n]+)/);
    if (done) created.push(JSON.parse(done[1]!).conversationId);
  });

  it('isolates conversation history by signed subject and denies unlisted courses', async () => {
    const alice = { authorization: `Bearer ${token('alice')}` };
    const bob = { authorization: `Bearer ${token('bob')}` };
    const forbidden = await app.inject({ method: 'POST', url: '/v1/chat', headers: alice, payload: { message: 'Explain Physics', scope: { courseId: 'physics' } } });
    expect(forbidden.statusCode).toBe(403);
    const forbiddenStream = await app.inject({ method: 'POST', url: '/v1/chat/stream', headers: alice, payload: { message: 'Explain Physics', scope: { courseId: 'physics' } } });
    expect(forbiddenStream.statusCode).toBe(403);
    const createdResponse = await app.inject({ method: 'POST', url: '/v1/chat', headers: alice, payload: { message: 'Hi', scope: { courseId: 'dbms' } } });
    expect(createdResponse.statusCode).toBe(200);
    const id = createdResponse.json().conversationId as string;
    created.push(id);
    expect((await app.inject({ method: 'GET', url: `/v1/conversations/${id}`, headers: alice })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/conversations/${id}`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/chat', headers: bob, payload: { message: 'Hi', conversationId: id } })).statusCode).toBe(400);
    const lostCourse = { authorization: `Bearer ${token('alice', ['physics'])}` };
    expect((await app.inject({ method: 'GET', url: `/v1/conversations/${id}`, headers: lostCourse })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/conversations', headers: lostCourse })).json().some((conversation: { id: string }) => conversation.id === id)).toBe(false);
  });
});
