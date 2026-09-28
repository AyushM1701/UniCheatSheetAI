import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from '@ucs/database';
import { sha256 } from '@ucs/drive-sync';
import { ingestPdf } from '@ucs/ingestion';
import type { IndexDocumentInput } from './types.js';

export async function indexDocument({ resource, cached, remote }: IndexDocumentInput) {
  if (!resource.courseId) throw new Error(`Resource ${resource.driveFileId} has no resolved course ID`);
  if (resource.driveFileId !== cached.driveFileId) throw new Error('Catalog and cache Drive IDs disagree');
  const path = resolve(cached.localPath);
  const info = await stat(path);
  if (!info.isFile() || info.size !== cached.fileSize || await sha256(path) !== cached.checksum) throw new Error('Cached file does not match the sync manifest; run pnpm sync:drive');
  if (!path.toLowerCase().endsWith('.pdf')) throw new Error('Only PDFs can be indexed in this sprint');
  const course = await db.course.findUnique({ where: { id: resource.courseId } });
  if (!course) throw new Error(`Course ${resource.courseId} is missing; run pnpm db:seed`);
  const now = new Date();
  const source = await db.sourceFile.upsert({
    where: { provider_remoteFileId: { provider: 'google_drive', remoteFileId: resource.driveFileId } },
    create: { id: randomUUID(), provider: 'google_drive', remoteRoot: remote, remoteFileId: resource.driveFileId, remotePath: resource.driveFileId, localPath: cached.localPath, name: resource.title, resourceType: resource.type, mimeType: 'application/pdf', size: BigInt(info.size), localHash: cached.checksum, modifiedAt: null, lastSeenAt: now, lastCheckedAt: now, syncStatus: 'cached', courseId: resource.courseId, sourceUrl: resource.sourceUrl, active: false },
    update: { remoteRoot: remote, remotePath: resource.driveFileId, localPath: cached.localPath, name: resource.title, resourceType: resource.type, mimeType: 'application/pdf', size: BigInt(info.size), localHash: cached.checksum, lastSeenAt: now, lastCheckedAt: now, syncStatus: 'cached', courseId: resource.courseId, sourceUrl: resource.sourceUrl }
  });
  try {
    const result = await ingestPdf({ filePath: path, documentId: `document-${source.id}`, courseId: resource.courseId, title: resource.title, type: resource.type, source: 'google_drive', sourceUrl: resource.sourceUrl });
    await db.sourceFile.update({ where: { id: source.id }, data: { academicDocumentId: result.documentId, indexedAt: new Date(), indexStatus: 'indexed', active: true } });
    return { ...result, sourceFileId: source.id };
  } catch (error) {
    await db.sourceFile.update({ where: { id: source.id }, data: { indexStatus: 'error' } });
    throw error;
  }
}
