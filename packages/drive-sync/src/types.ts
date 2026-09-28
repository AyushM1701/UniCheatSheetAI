import type { ScannedResource } from '@ucs/unicheatsheet-source';

export type DriveResource = ScannedResource;

export interface CachedFile {
  driveFileId: string;
  localPath: string;
  originalName: string;
  downloadedAt: string;
  fileSize: number;
  checksum: string;
}

export interface DriveManifest {
  version: 1;
  remote: string;
  resources: Record<string, CachedFile>;
}

export interface CacheSyncConfig {
  remote: string;
  cacheDir: string;
  tempDir: string;
  manifestPath: string;
  courseId?: string;
  limit?: number;
  refreshHours?: number;
  binary?: string;
  runner?: (args: string[]) => Promise<string>;
  onProgress?: (message: string) => void;
}

export interface CacheSyncResult {
  catalogResources: number;
  selected: number;
  downloaded: number;
  reorganized: number;
  skipped: number;
  failed: number;
  failures: Array<{ driveFileId: string; reason: string }>;
}
