import 'dotenv/config';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { db } from '../packages/database/src/index.js';
import { RcloneIdSource } from '../packages/drive-sync/src/index.js';
import type { WebsiteResource } from '../packages/unicheatsheet-source/src/types.js';
import { buildApp } from '../apps/api/src/app.js';

process.env.EMBEDDING_PROVIDER = 'local';
const ids = ['ucsfixturealpha123', 'ucsfixturebeta123'];
const resource = (driveFileId: string): WebsiteResource => ({ semester: 3, courseId: 'dbms', courseName: 'DBMS', type: 'lecture', title: `Fixture ${driveFileId}`, provider: 'google_drive', driveFileId, sourceUrl: `https://drive.google.com/file/d/${driveFileId}/view`, originFile: 'sem3/lecture.html' });

describe('Drive catalog lifecycle', () => {
  it('indexes referenced IDs, reuses fresh cache and deactivates removed site references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-lifecycle-'));
    const calls: string[][] = [];
    await db.course.upsert({ where: { id: 'dbms' }, create: { id: 'dbms', name: 'Database Management Systems', semester: 3, aliases: ['DBMS'] }, update: {} });
    const source = new RcloneIdSource({ remote: 'ucs-fixture:', cacheDir: join(root, 'cache'), manifestPath: join(root, 'manifest.json'), limit: 1, runner: async (args) => { calls.push(args); await copyFile('data/samples/dbms-normalization.pdf', args[4]!); return ''; } });
    try {
      expect(await source.sync([resource(ids[0]!)] )).toMatchObject({ downloaded: 1, indexed: 1, failed: 0 });
      expect(await source.sync([resource(ids[0]!)] )).toMatchObject({ downloaded: 0, skipped: 1, failed: 0 });
      expect(calls.map((args) => args[3])).toEqual([ids[0]]);
      expect(await source.sync([resource(ids[1]!)] )).toMatchObject({ downloaded: 1, indexed: 1, deactivated: 1, failed: 0 });
      const rows = await db.sourceFile.findMany({ where: { provider: 'google_drive', remoteFileId: { in: ids } }, orderBy: { remoteFileId: 'asc' } });
      expect(rows.map((row) => [row.remoteFileId, row.active])).toEqual([[ids[0], false], [ids[1], true]]);
      const app = buildApp();
      try {
        const response = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: 'normalization', courseId: 'dbms', source: 'google_drive', limit: 10 } });
        expect(response.statusCode).toBe(200);
        const results = response.json().results as Array<{ documentId: string }>;
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((hit) => hit.documentId === `document-${rows[1]!.id}`)).toBe(true);
      } finally { await app.close(); }
    } finally {
      const rows = await db.sourceFile.findMany({ where: { provider: 'google_drive', remoteFileId: { in: ids } } });
      await db.sourceFile.deleteMany({ where: { provider: 'google_drive', remoteFileId: { in: ids } } });
      await db.academicDocument.deleteMany({ where: { id: { in: rows.map((row) => `document-${row.id}`) } } });
      await rm(root, { recursive: true, force: true });
      await db.$disconnect();
    }
  });
});
