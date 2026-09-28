import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';
import { RcloneIdSource } from '@ucs/drive-sync';
import { validateResources, type WebsiteResource } from '@ucs/unicheatsheet-source';

const remote = process.env.DRIVE_REMOTE;
if (!remote) throw new Error('Set DRIVE_REMOTE to the configured rclone root, for example unicheatsheetAI:');
const catalogPath = process.argv[2] ?? process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const catalog = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
const resources: WebsiteResource[] = catalog.filter((resource) => resource.courseId && resource.courseName).map((resource) => ({ semester: resource.semester, courseId: resource.courseId!, courseName: resource.courseName!, type: resource.type, title: resource.title, provider: 'google_drive', driveFileId: resource.driveFileId, sourceUrl: resource.sourceUrl, originFile: resource.sourcePage }));
if (!resources.length) throw new Error(`No resources with resolved course IDs in ${catalogPath}; add course aliases or choose a populated catalog`);
if (resources.length !== catalog.length) console.warn(`Skipping ${catalog.length - resources.length} resource(s) with unresolved course IDs`);
const source = new RcloneIdSource({
  remote,
  courseId: process.env.DRIVE_COURSE_ID || undefined,
  cacheDir: process.env.DRIVE_CACHE_DIR ?? 'data/drive-cache',
  manifestPath: process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json',
  limit: Number(process.env.DRIVE_LIMIT ?? 1),
  refreshHours: Number(process.env.DRIVE_REFRESH_HOURS ?? 24),
  reconcileMissing: process.env.DRIVE_CATALOG_COMPLETE === 'true'
});
try {
  const result = await source.sync(resources);
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
} finally { await db.$disconnect(); }
