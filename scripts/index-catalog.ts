import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';
import { indexDocument } from '@ucs/indexing';
import { validateResources } from '@ucs/unicheatsheet-source';
import type { DriveManifest } from '@ucs/drive-sync';

const catalogPath = process.argv[2] ?? process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const manifestPath = process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json';
const resources = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DriveManifest;
const limit = Number(process.env.INDEX_LIMIT ?? resources.length);
if (!Number.isInteger(limit) || limit < 1) throw new Error('INDEX_LIMIT must be a positive integer');
const results = { selected: 0, indexed: 0, unchanged: 0, missingCache: 0, failed: [] as Array<{ driveFileId: string; error: string }> };
try {
  for (const resource of resources.slice(0, limit)) {
    results.selected++;
    const cached = manifest.resources[resource.driveFileId];
    if (!cached) { results.missingCache++; continue; }
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
