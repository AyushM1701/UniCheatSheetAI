import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';
import { indexDocument } from '@ucs/indexing';
import { currentIndexingKey } from '@ucs/ingestion';
import { validateResources } from '@ucs/unicheatsheet-source';
import type { DriveManifest } from '@ucs/drive-sync';

const catalogPath = process.argv[2] ?? process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const manifestPath = process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json';
const resources = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DriveManifest;
const limit = Number(process.env.INDEX_LIMIT ?? resources.length);
if (!Number.isInteger(limit) || limit < 1) throw new Error('INDEX_LIMIT must be a positive integer');
const results = { selected: 0, pending: 0, remaining: 0, indexed: 0, unchanged: 0, missingCache: 0, failed: [] as Array<{ driveFileId: string; error: string }> };
try {
  const existing = await db.sourceFile.findMany({
    where: { provider: 'google_drive', remoteFileId: { in: resources.map((resource) => resource.driveFileId) } },
    select: { remoteFileId: true, remoteRoot: true, courseId: true, name: true, resourceType: true, sourceUrl: true, active: true, academicDocument: { select: { checksum: true, courseId: true, title: true, type: true, sourceUrl: true, processingStatus: true, metadata: true } } }
  });
  const byId = new Map(existing.map((source) => [source.remoteFileId, source]));
  results.missingCache = resources.filter((resource) => !manifest.resources[resource.driveFileId]).length;
  const pending = resources.filter((resource) => {
    const cached = manifest.resources[resource.driveFileId];
    if (!cached) return false;
    const source = byId.get(resource.driveFileId);
    const document = source?.academicDocument;
    const metadata = document?.metadata as { indexingKey?: string } | undefined;
    return !source || !source.active || source.remoteRoot !== manifest.remote || source.courseId !== resource.courseId || source.name !== resource.title || source.resourceType !== resource.type || source.sourceUrl !== resource.sourceUrl || !document || document.processingStatus !== 'indexed' || document.checksum !== cached.checksum || document.courseId !== resource.courseId || document.title !== resource.title || document.type !== resource.type || document.sourceUrl !== resource.sourceUrl || metadata?.indexingKey !== currentIndexingKey(resource.type);
  });
  results.pending = pending.length;
  results.remaining = Math.max(0, pending.length - limit);
  for (const resource of pending.slice(0, limit)) {
    results.selected++;
    const cached = manifest.resources[resource.driveFileId]!;
    try {
      const result = await indexDocument({ resource, cached, remote: manifest.remote });
      if (result.skipped) results.unchanged++;
      else results.indexed++;
      console.log(`${result.skipped ? 'Unchanged' : 'Indexed'}: ${resource.title} (${result.chunks} chunks)`);
    } catch (error) {
      results.failed.push({ driveFileId: resource.driveFileId, error: error instanceof Error ? error.message : String(error) });
    }
  }
} finally { await db.$disconnect(); }
console.log(JSON.stringify(results, null, 2));
if (results.failed.length || results.missingCache) process.exitCode = 1;
