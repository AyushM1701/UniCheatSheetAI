import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { copyDriveFile, getDestinationPath, sha256 } from './downloader.js';
import { readManifest, validCachedFile, writeManifest } from './manifest.js';
import type { CacheSyncConfig, CacheSyncResult, CachedFile, DriveResource } from './types.js';

async function checkCached(resource: DriveResource, cached: unknown, cacheDir: string): Promise<'current' | 'reorganized' | false> {
  if (!validCachedFile(cached, resource.driveFileId)) return false;
  const row: CachedFile = cached;
  const source = resolve(row.localPath);
  const root = resolve(cacheDir);
  const relativeSource = relative(root, source);
  if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${sep}`) || isAbsolute(relativeSource)) return false;
  try {
    const file = await stat(source);
    if (!file.isFile() || file.size !== row.fileSize || await sha256(source) !== row.checksum) return false;
    const destination = getDestinationPath(resource, row.originalName, cacheDir);
    if (source === destination) return 'current';
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    row.localPath = relative(process.cwd(), destination).replaceAll('\\', '/');
    return 'reorganized';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function syncResources(resources: DriveResource[], config: CacheSyncConfig): Promise<CacheSyncResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*:$/.test(config.remote)) throw new Error('Set DRIVE_REMOTE to an rclone remote root ending in :');
  const limit = config.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('DRIVE_LIMIT must be a positive integer');
  const refreshHours = config.refreshHours ?? 24;
  if (!Number.isFinite(refreshHours) || refreshHours < 0) throw new Error('DRIVE_REFRESH_HOURS must be nonnegative');
  const unique = [...new Map(resources.map((resource) => [resource.driveFileId, resource])).values()];
  const manifest = await readManifest(config.manifestPath, config.remote);
  const candidates = unique.filter((resource) => !config.courseId || resource.courseId === config.courseId);
  candidates.sort((left, right) => {
    const a = Date.parse(manifest.resources[left.driveFileId]?.downloadedAt ?? '') || 0;
    const b = Date.parse(manifest.resources[right.driveFileId]?.downloadedAt ?? '') || 0;
    return a - b;
  });
  const selected = candidates.slice(0, limit);
  const result: CacheSyncResult = { catalogResources: resources.length, selected: selected.length, downloaded: 0, reorganized: 0, skipped: 0, failed: 0, failures: [] };
  for (const resource of selected) {
    config.onProgress?.(`Checking ${resource.title} (${resource.driveFileId})`);
    try {
      const cachedState = await checkCached(resource, manifest.resources[resource.driveFileId], config.cacheDir);
      const downloadedAt = Date.parse(manifest.resources[resource.driveFileId]?.downloadedAt ?? '');
      const fresh = Number.isFinite(downloadedAt) && Date.now() - downloadedAt < refreshHours * 3600000;
      if (cachedState && fresh) {
        if (cachedState === 'reorganized') {
          await writeManifest(config.manifestPath, manifest);
          result.reorganized++;
          config.onProgress?.(`Reorganized: ${manifest.resources[resource.driveFileId]!.localPath}`);
        } else {
          result.skipped++;
          config.onProgress?.(`Already cached: ${resource.title}`);
        }
        continue;
      }
      const cached = await copyDriveFile(resource, config);
      manifest.resources[resource.driveFileId] = cached;
      await writeManifest(config.manifestPath, manifest);
      result.downloaded++;
      config.onProgress?.(`Downloaded: ${cached.localPath}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.failed++;
      result.failures.push({ driveFileId: resource.driveFileId, reason });
      config.onProgress?.(`Failed ${resource.driveFileId}: ${reason}`);
    }
  }
  return result;
}
