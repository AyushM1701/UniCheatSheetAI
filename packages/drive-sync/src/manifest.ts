import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CachedFile, DriveManifest } from './types.js';

export async function readManifest(path: string, remote: string): Promise<DriveManifest> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, remote, resources: {} };
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<DriveManifest>;
  if (parsed.version !== 1 || typeof parsed.remote !== 'string' || !parsed.resources || typeof parsed.resources !== 'object' || Array.isArray(parsed.resources)) throw new Error(`Invalid Drive manifest: ${path}`);
  if (parsed.remote !== remote) throw new Error(`Drive manifest ${path} belongs to ${parsed.remote}; set a separate DRIVE_MANIFEST_PATH for ${remote}`);
  return parsed as DriveManifest;
}

export async function writeManifest(path: string, manifest: DriveManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function validCachedFile(value: unknown, driveFileId: string): value is CachedFile {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<CachedFile>;
  return row.driveFileId === driveFileId && typeof row.localPath === 'string' && typeof row.originalName === 'string' && typeof row.downloadedAt === 'string' && typeof row.fileSize === 'number' && row.fileSize > 0 && typeof row.checksum === 'string' && /^[a-f0-9]{64}$/.test(row.checksum);
}
