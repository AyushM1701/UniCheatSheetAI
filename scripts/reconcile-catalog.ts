import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';
import { validateResources } from '@ucs/unicheatsheet-source';

const catalogPath = process.argv[2] ?? process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';
const apply = process.argv.includes('--apply');
const remote = process.env.DRIVE_REMOTE;
if (!remote || !/^[A-Za-z0-9][A-Za-z0-9_-]*:$/.test(remote)) throw new Error('Set DRIVE_REMOTE to the authoritative remote root');
const resources = validateResources(JSON.parse(await readFile(catalogPath, 'utf8')));
if (!resources.length || resources.some((item) => !item.courseId) || new Set(resources.map((item) => item.driveFileId)).size !== resources.length) {
  throw new Error('Reconciliation requires a nonempty catalog with unique Drive IDs and resolved course IDs');
}
const ids = resources.map((item) => item.driveFileId);
try {
  const candidates = await db.sourceFile.findMany({ where: { provider: 'google_drive', remoteRoot: remote, active: true, remoteFileId: { notIn: ids } }, select: { id: true, remoteFileId: true, name: true } });
  console.log(JSON.stringify({ catalog: catalogPath, remote, catalogResources: resources.length, wouldDeactivate: candidates }, null, 2));
  if (apply) {
    if (process.env.DRIVE_CATALOG_COMPLETE !== 'true') throw new Error('Set DRIVE_CATALOG_COMPLETE=true only after validating this authoritative complete catalog');
    await db.sourceFile.updateMany({ where: { id: { in: candidates.map((item) => item.id) }, active: true }, data: { active: false, syncStatus: 'missing' } });
    console.log(`Deactivated ${candidates.length} withdrawn source(s)`);
  } else console.log('Preview only. Use --apply with DRIVE_CATALOG_COMPLETE=true after reviewing the full catalog.');
} finally { await db.$disconnect(); }
