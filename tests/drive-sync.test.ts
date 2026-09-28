import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractDriveFileId, scanUniCheatSheet, scanWebsite, writeResourceCatalog } from '../packages/unicheatsheet-source/src/index.js';
import { RcloneIdSource } from '../packages/drive-sync/src/index.js';
import type { WebsiteResource } from '../packages/unicheatsheet-source/src/types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('website Drive catalog', () => {
  it('extracts file IDs without accepting folders or unrelated hosts', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/abc_DEF-123/view?usp=sharing')).toBe('abc_DEF-123');
    expect(extractDriveFileId('https://docs.google.com/document/d/doc123/edit')).toBe('doc123');
    expect(extractDriveFileId('https://drive.google.com/open?id=open123')).toBe('open123');
    expect(extractDriveFileId('https://drive.google.com/drive/folders/folder123')).toBeNull();
    expect(extractDriveFileId('https://evil.example/file/d/abc123/view')).toBeNull();
    expect(extractDriveFileId('#')).toBeNull();
  });

  it('maps semester, course and resource type while preserving distinct logical references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-site-')); roots.push(root);
    await mkdir(join(root, 'sem3'));
    await writeFile(join(root, 'sem3', 'lecture.html'), '<section id="dbms"><h2>DBMS</h2><a href="https://drive.google.com/file/d/notes123/view"><span class="hover-text">Normalization Notes</span></a><a href="https://drive.google.com/file/d/notes456/view"><span class="hover-text">Normalization Notes</span></a><a href="#">Coming soon</a><a href="https://drive.google.com/drive/folders/folder123">Folder</a></section><section id="unknown"><h2>Unlisted Subject</h2><a href="https://drive.google.com/file/d/unknown123/view">Unknown</a></section>');
    await writeFile(join(root, 'sem3', 'pyqs.html'), '<section><h2>DBMS</h2><a href="https://drive.google.com/open?id=paper123">2025 paper</a><a href="https://drive.google.com/file/d/notes123/view">Repeat</a></section>');
    const report = await scanWebsite(root, [{ id: 'dbms', name: 'Database Management Systems', aliases: ['DBMS'] }]);
    expect(report).toMatchObject({ filesScanned: 2, driveLinks: 5, duplicateIds: 0 });
    expect(report.resources.map((item) => item.driveFileId)).toEqual(['notes123', 'notes456', 'paper123', 'notes123']);
    expect(report.resources[0]).toMatchObject({ semester: 3, courseId: 'dbms', type: 'lecture', title: 'Normalization Notes', originFile: 'sem3/lecture.html' });
    expect(report.unresolved).toMatchObject([{ driveFileId: 'unknown123', sectionId: 'unknown', surroundingHeading: 'Unlisted Subject' }]);
    expect(report.unresolved[0]?.courseId).toBeUndefined();
    const raw = await scanUniCheatSheet(root);
    expect(raw.resources.map((item) => item.driveFileId)).toEqual(['notes123', 'notes456', 'unknown123', 'paper123', 'notes123']);
    const output = join(root, 'resources.raw.json');
    await writeResourceCatalog(output, raw.resources);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(raw.resources);
  });
});

describe('ID-based rclone source', () => {
  it('copies only the specified ID and rejects non-PDF content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ucs-id-')); roots.push(root);
    const calls: string[][] = [];
    const source = new RcloneIdSource({ remote: 'unicheatsheetAI:', cacheDir: join(root, 'cache'), manifestPath: join(root, 'manifest.json'), runner: async (args) => { calls.push(args); await writeFile(args[4]!, '%PDF-1.7\nmock'); return ''; } });
    const resource: WebsiteResource = { semester: 3, courseId: 'dbms', courseName: 'DBMS', type: 'lecture', title: 'Notes', provider: 'google_drive', driveFileId: 'notes123', sourceUrl: 'https://drive.google.com/file/d/notes123/view', originFile: 'sem3/lecture.html' };
    const path = await source.download(resource);
    expect(calls).toEqual([['backend', 'copyid', 'unicheatsheetAI:', 'notes123', expect.stringContaining('notes123.pdf.partial-')]]);
    expect(await readFile(path, 'utf8')).toBe('%PDF-1.7\nmock');
    await expect(source.download({ ...resource, driveFileId: 'other123' })).rejects.toThrow('disagree');
    const bad = new RcloneIdSource({ remote: 'unicheatsheetAI:', cacheDir: join(root, 'bad'), manifestPath: join(root, 'manifest.json'), runner: async (args) => { await writeFile(args[4]!, '<html>not a PDF</html>'); return ''; } });
    await expect(bad.download(resource)).rejects.toThrow('not a PDF');
  });
});
