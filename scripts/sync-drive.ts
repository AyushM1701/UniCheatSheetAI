import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { syncResources } from '@ucs/drive-sync';
import { validateResources } from '@ucs/unicheatsheet-source';

const catalogPath = process.argv[2] ?? process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const resources = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
console.log(`Catalog: ${catalogPath} (${resources.length} resource${resources.length === 1 ? '' : 's'})`);
if (!resources.length) {
  console.log('No Drive resources to sync. Add real links to the website source, then run pnpm scan:resources.');
} else {
  const remote = process.env.DRIVE_REMOTE;
  if (!remote) throw new Error('Set DRIVE_REMOTE to the configured rclone remote root');
  const result = await syncResources(resources, {
    remote,
    cacheDir: process.env.DRIVE_CACHE_DIR ?? 'data/drive-cache',
    tempDir: process.env.DRIVE_TEMP_DIR ?? 'data/temp',
    manifestPath: process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json',
    courseId: process.env.DRIVE_COURSE_ID || undefined,
    limit: Number(process.env.DRIVE_LIMIT ?? 3),
    refreshHours: Number(process.env.DRIVE_REFRESH_HOURS ?? 24),
    binary: process.env.RCLONE_BINARY ?? 'rclone',
    onProgress: console.log
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}
