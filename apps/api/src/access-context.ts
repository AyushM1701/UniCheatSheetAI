import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { importSPKI, jwtVerify } from 'jose';
import { z } from 'zod';
import { db } from '@ucs/database';

const devSchema = z.object({
  semester: z.number().int().min(1).max(12),
  allowedCourses: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1),
  currentCourseId: z.string().nullable().optional()
}).strict();
const tokenSchema = z.object({
  sub: z.string().min(1).max(200),
  semester: z.number().int().min(1).max(12),
  courses: z.array(z.string().min(1)).min(1).max(100),
  currentCourseId: z.string().nullable().optional(),
  exp: z.number().int(),
  iat: z.number().int()
});
export interface UserAcademicContext {
  userId: string;
  semester: number;
  allowedCourses: Array<{ id: string; name: string }>;
  currentCourseId?: string | null;
}
export interface AccessContextProvider { getContext(request: FastifyRequest): Promise<UserAcademicContext> }
export class InvalidAccessTokenError extends Error {}

export class DevAccessContextProvider implements AccessContextProvider {
  async getContext(): Promise<UserAcademicContext> {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const path = resolve(root, process.env.DEV_ACCESS_CONTEXT_FILE ?? 'dev-context.json');
    const context = devSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (context.currentCourseId && !context.allowedCourses.some((course) => course.id === context.currentCourseId)) {
      throw new Error('currentCourseId must be in allowedCourses');
    }
    return { ...context, userId: 'dev-local' };
  }
}

export class JwtAccessContextProvider implements AccessContextProvider {
  private publicKey?: Promise<Awaited<ReturnType<typeof importSPKI>>>;
  async getContext(request: FastifyRequest): Promise<UserAcademicContext> {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new InvalidAccessTokenError('AI access token required');
    const pem = process.env.AI_JWT_PUBLIC_KEY?.replaceAll('\\n', '\n');
    const keyPath = process.env.AI_JWT_PUBLIC_KEY_FILE;
    const issuer = process.env.AI_JWT_ISSUER;
    const audience = process.env.AI_JWT_AUDIENCE;
    if ((!pem && !keyPath) || !issuer || !audience) throw new Error('JWT access provider is not configured');
    this.publicKey ??= importSPKI(pem ?? await readFile(keyPath!, 'utf8'), 'RS256');
    try {
      const { payload } = await jwtVerify(match[1]!, await this.publicKey, { algorithms: ['RS256'], issuer, audience, maxTokenAge: '15m' });
      const claims = tokenSchema.parse(payload);
      if (claims.exp - claims.iat > 15 * 60) throw new Error('Token lifetime exceeds 15 minutes');
      const ids = [...new Set(claims.courses)];
      if (claims.currentCourseId && !ids.includes(claims.currentCourseId)) throw new Error('Current course is not allowed');
      const rows = await db.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      if (rows.length !== ids.length) throw new Error('Token contains an unknown course');
      const names = new Map(rows.map((course) => [course.id, course.name]));
      return { userId: claims.sub, semester: claims.semester, allowedCourses: ids.map((id) => ({ id, name: names.get(id)! })), currentCourseId: claims.currentCourseId ?? null };
    } catch {
      throw new InvalidAccessTokenError('Invalid or expired AI access token');
    }
  }
}

export function createAccessContextProvider(): AccessContextProvider {
  const mode = process.env.ACCESS_CONTEXT_PROVIDER ?? 'dev';
  if (mode === 'dev') return new DevAccessContextProvider();
  if (mode === 'jwt') {
    if ((!process.env.AI_JWT_PUBLIC_KEY && !process.env.AI_JWT_PUBLIC_KEY_FILE) || !process.env.AI_JWT_ISSUER || !process.env.AI_JWT_AUDIENCE) throw new Error('JWT access provider requires public key, issuer, and audience');
    return new JwtAccessContextProvider();
  }
  throw new Error(`Unsupported ACCESS_CONTEXT_PROVIDER: ${mode}`);
}
