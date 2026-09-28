import type { CachedFile } from '@ucs/drive-sync';
import type { ScannedResource } from '@ucs/unicheatsheet-source';

export interface IndexDocumentInput {
  resource: ScannedResource;
  cached: CachedFile;
  remote: string;
}
