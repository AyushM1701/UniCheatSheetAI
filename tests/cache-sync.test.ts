import { copyFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDestinationPath, slugify, syncResources } from '../packages/drive-sync/src/index.js';
import type { DriveResource } from '../packages/drive-sync/src/types.js';

const resource: DriveResource = { semester: 3, courseId: 'dbms', courseName: 'Database Management Systems', type: 'lecture', title: 'Database Normalization: 1NF / 2NF / 3NF', provider: 'google_drive', driveFileId: 'fixtureABC123', sourceUrl: 'https://drive.google.com/file/d/fixtureABC123/view', sourcePage: 'sem3/lecture.html' };

describe('cache-only Drive sync', () => {
  it('preserves the source extension, records SHA-256, skips intact files, and recreates missing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-cache-sync-'));
    const calls: string[][] = [];
    const config = { remote: 'fixture-drive:', cacheDir: join(root, 'cache'), tempDir: join(root, 'temp'), manifestPath: join(root, 'manifest.json'), runner: async (args: string[]) => { calls.push(args); await copyFile('data/samples/dbms-normalization.pdf', join(args[4]!, 'Original Name.PDF')); return ''; } };
    try {
      expect(slugify(resource.title)).toBe('database-normalization-1nf-2nf-3nf');
      expect(await syncResources([resource], config)).toMatchObject({ downloaded: 1, skipped: 0, failed: 0 });
      expect(calls[0]?.slice(0, 4)).toEqual(['backend', 'copyid', 'fixture-drive:', 'fixtureABC123']);
      expect(calls[0]?.[4]).toMatch(/\/$/);
      const manifest = JSON.parse(await readFile(config.manifestPath, 'utf8'));
      const entry = manifest.resources.fixtureABC123;
      expect(entry.localPath).toContain('sem3/dbms/lecture/database-normalization-1nf-2nf-3nf--fixtureABC123.pdf');
      expect(entry.originalName).toBe('Original Name.PDF');
      expect(entry.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(await syncResources([resource], config)).toMatchObject({ downloaded: 0, skipped: 1 });
      expect(calls).toHaveLength(1);
      await unlink(resolve(entry.localPath));
      expect(await syncResources([resource], config)).toMatchObject({ downloaded: 1, skipped: 0 });
      expect(calls).toHaveLength(2);
      await writeFile(resolve(entry.localPath), 'corrupt');
      expect(await syncResources([resource], config)).toMatchObject({ downloaded: 1, skipped: 0 });
      expect(calls).toHaveLength(3);
      expect(await syncResources([{ ...resource, courseId: 'physics' }], config)).toMatchObject({ downloaded: 0, reorganized: 1 });
      expect(calls).toHaveLength(3);
      const moved = JSON.parse(await readFile(config.manifestPath, 'utf8')).resources.fixtureABC123;
      expect(moved.localPath).toContain('sem3/physics/lecture/');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps duplicate titles separate by Drive ID and rejects empty downloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-cache-sync-'));
    const second = { ...resource, driveFileId: 'fixtureDEF456', sourceUrl: 'https://drive.google.com/file/d/fixtureDEF456/view' };
    try {
      expect(getDestinationPath(resource, 'Notes.docx', root)).not.toBe(getDestinationPath(second, 'Notes.docx', root));
      const result = await syncResources([resource], { remote: 'fixture-drive:', cacheDir: join(root, 'cache'), tempDir: join(root, 'temp'), manifestPath: join(root, 'manifest.json'), runner: async (args) => { await writeFile(join(args[4]!, 'empty.pdf'), ''); return ''; } });
      expect(result).toMatchObject({ downloaded: 0, failed: 1 });
      expect(result.failures[0]?.reason).toContain('empty');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('advances through a limited catalog and refreshes cached files when due', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-cache-batches-'));
    const ids = ['batchA123', 'batchB123', 'batchC123'];
    const resources = ids.map((id) => ({ ...resource, driveFileId: id, sourceUrl: `https://drive.google.com/file/d/${id}/view` }));
    const calls: string[] = [];
    const config = { remote: 'fixture-drive:', cacheDir: join(root, 'cache'), tempDir: join(root, 'temp'), manifestPath: join(root, 'manifest.json'), limit: 1, runner: async (args: string[]) => { calls.push(args[3]!); await copyFile('data/samples/dbms-normalization.pdf', join(args[4]!, 'File.pdf')); return ''; } };
    try {
      for (let index = 0; index < 3; index++) expect((await syncResources(resources, config)).downloaded).toBe(1);
      expect(calls).toEqual(ids);
      expect((await syncResources(resources, { ...config, refreshHours: 0 })).downloaded).toBe(1);
      expect(calls).toHaveLength(4);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
