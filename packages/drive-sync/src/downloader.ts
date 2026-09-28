import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { extractDriveFileId } from '@ucs/unicheatsheet-source';
import { runRclone } from './rclone.js';
import type { CacheSyncConfig, CachedFile, DriveResource } from './types.js';

const DRIVE_ID = /^[A-Za-z0-9_-]{3,}$/;

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resource';
}

export function getDestinationDir(resource: DriveResource, cacheDir: string): string {
  if (!Number.isInteger(resource.semester) || resource.semester < 1) throw new Error('Invalid semester');
  if (!['lecture', 'pyq', 'solution', 'assignment', 'tutorial', 'other'].includes(resource.type)) throw new Error('Invalid resource type');
  return resolve(cacheDir, `sem${resource.semester}`, slugify(resource.courseId ?? 'unknown-course'), resource.type);
}

function extensionOf(name: string): string {
  const extension = extname(name).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(extension)) throw new Error(`Unsupported or missing file extension: ${name}`);
  return extension;
}

export function getDestinationPath(resource: DriveResource, originalName: string, cacheDir: string): string {
  if (!DRIVE_ID.test(resource.driveFileId)) throw new Error('Invalid Google Drive file ID');
  return join(getDestinationDir(resource, cacheDir), `${slugify(resource.title)}--${resource.driveFileId}${extensionOf(originalName)}`);
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyFile(path: string, extension: string): Promise<number> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1) throw new Error('Downloaded file is empty or invalid');
  if (extension === '.pdf') {
    const file = await open(path, 'r');
    try {
      const header = Buffer.alloc(5);
      await file.read(header, 0, 5, 0);
      if (header.toString() !== '%PDF-') throw new Error('Downloaded PDF has an invalid header');
    } finally { await file.close(); }
  }
  return info.size;
}

export async function copyDriveFile(resource: DriveResource, config: CacheSyncConfig): Promise<CachedFile> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*:$/.test(config.remote)) throw new Error('Use an rclone remote root ending in :');
  if (extractDriveFileId(resource.sourceUrl) !== resource.driveFileId) throw new Error('Catalog URL and Drive ID disagree');
  const tempBase = resolve(config.tempDir);
  await mkdir(tempBase, { recursive: true });
  const temporary = await mkdtemp(join(tempBase, 'drive-'));
  const relativeTemp = relative(tempBase, resolve(temporary));
  if (!relativeTemp || relativeTemp === '..' || relativeTemp.startsWith(`..${sep}`) || isAbsolute(relativeTemp)) throw new Error('Temporary directory escaped configured temp root');
  try {
    const runner = config.runner ?? ((args: string[]) => runRclone(args, config.binary));
    await runner(['backend', 'copyid', config.remote, resource.driveFileId, `${temporary.replaceAll('\\', '/')}/`]);
    const entries = (await readdir(temporary, { withFileTypes: true })).filter((entry) => entry.isFile());
    if (entries.length !== 1) throw new Error(`Expected one downloaded file for ${resource.driveFileId}, found ${entries.length}`);
    const originalName = basename(entries[0]!.name);
    const extension = extensionOf(originalName);
    const from = join(temporary, originalName);
    const fileSize = await verifyFile(from, extension);
    const checksum = await sha256(from);
    const destination = getDestinationPath(resource, originalName, config.cacheDir);
    await mkdir(dirname(destination), { recursive: true });
    const partial = `${destination}.partial-${randomUUID()}`;
    try {
      await copyFile(from, partial);
      await rename(partial, destination);
    } finally {
      await unlink(partial).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    return { driveFileId: resource.driveFileId, localPath: relative(process.cwd(), destination).replaceAll('\\', '/'), originalName, downloadedAt: new Date().toISOString(), fileSize, checksum };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
