import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { db } from '@ucs/database';
import { indexDocument } from '@ucs/indexing';
import { validateResources } from '@ucs/unicheatsheet-source';
import type { CachedFile, DriveManifest } from '@ucs/drive-sync';

const filePath = process.argv[2];
if (!filePath) throw new Error('Pass a cached PDF path: pnpm index:file "data/drive-cache/.../file.pdf"');
const absolutePath = resolve(filePath);
const manifestPath = process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json';
const catalogPath = process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DriveManifest;
const match = Object.entries(manifest.resources).find(([, cached]) => resolve(cached.localPath) === absolutePath) as [string, CachedFile] | undefined;
if (!match) throw new Error(`File is not in ${manifestPath}; run pnpm sync:drive`);
const resources = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
const resource = resources.find((item) => item.driveFileId === match[0]);
if (!resource) throw new Error(`Drive ID ${match[0]} is not in ${catalogPath}`);
console.log(`Indexing: ${basename(absolutePath)}`);
try {
  const result = await indexDocument({ resource, cached: match[1], remote: manifest.remote });
  console.log(`Pages: ${result.pages}`);
  console.log(`Chunks: ${result.chunks}`);
  console.log(`Embeddings: ${result.embeddings}`);
  console.log(`Document: ${result.documentId}`);
  console.log(result.skipped ? 'INDEX UNCHANGED' : 'INDEX COMPLETE');
} finally { await db.$disconnect(); }
