import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { db } from '@ucs/database';
import { currentIndexingKey, ingestPdf } from '@ucs/ingestion';
import { extractDriveFileId, type WebsiteResource } from '@ucs/unicheatsheet-source';
import { runRclone } from './rclone.js';

export interface IdSyncConfig {
  remote: string;
  cacheDir: string;
  manifestPath: string;
  courseId?: string;
  limit?: number;
  refreshHours?: number;
  binary?: string;
  runner?: (args: string[]) => Promise<string>;
}

export interface IdSyncResult { catalogResources: number; selected: number; downloaded: number; indexed: number; skipped: number; deactivated: number; failed: number }

const DRIVE_ID = /^[A-Za-z0-9_-]{3,}$/;
const COURSE_ID = /^[a-z0-9][a-z0-9-]*$/;

async function existingFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function asJson(row: Awaited<ReturnType<typeof db.sourceFile.findFirst>>) {
  if (!row) return null;
  return { ...row, size: Number(row.size), modifiedAt: row.modifiedAt?.toISOString() ?? null, lastSeenAt: row.lastSeenAt.toISOString(), lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null, indexedAt: row.indexedAt?.toISOString() ?? null };
}

export class RcloneIdSource {
  readonly config: Required<Omit<IdSyncConfig, 'courseId' | 'runner'>> & Pick<IdSyncConfig, 'courseId'>;
  private readonly run: (args: string[]) => Promise<string>;

  constructor(config: IdSyncConfig) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*:$/.test(config.remote)) throw new Error('Use an rclone remote root such as unicheatsheetAI:');
    const limit = config.limit ?? 1;
    const refreshHours = config.refreshHours ?? 24;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    if (!Number.isFinite(refreshHours) || refreshHours < 0) throw new Error('refreshHours must be nonnegative');
    if (config.courseId && !COURSE_ID.test(config.courseId)) throw new Error('Invalid course ID');
    this.config = { remote: config.remote, cacheDir: resolve(config.cacheDir), manifestPath: resolve(config.manifestPath), courseId: config.courseId, limit, refreshHours, binary: config.binary ?? process.env.RCLONE_BINARY ?? 'rclone' };
    this.run = config.runner ?? ((args) => runRclone(args, this.config.binary));
  }

  private pathFor(resource: WebsiteResource): string {
    if (!DRIVE_ID.test(resource.driveFileId) || !COURSE_ID.test(resource.courseId)) throw new Error('Invalid resource identity');
    return resolve(this.config.cacheDir, resource.courseId, `${resource.driveFileId}.pdf`);
  }

  async download(resource: WebsiteResource): Promise<string> {
    if (extractDriveFileId(resource.sourceUrl) !== resource.driveFileId) throw new Error('Catalog URL and Drive ID disagree');
    const target = this.pathFor(resource);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.partial-${randomUUID()}`;
    try {
      await this.run(['backend', 'copyid', this.config.remote, resource.driveFileId, temporary]);
      const header = (await readFile(temporary)).subarray(0, 5).toString();
      if (header !== '%PDF-') throw new Error(`Drive file ${resource.driveFileId} is not a PDF`);
      await copyFile(temporary, target);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    return target;
  }

  async sync(resources: WebsiteResource[]): Promise<IdSyncResult> {
    if (!resources.length) throw new Error('Catalog has no Drive resources; refusing to deactivate existing sources');
    const allIds = new Set<string>();
    for (const resource of resources) {
      if (extractDriveFileId(resource.sourceUrl) !== resource.driveFileId) throw new Error(`Invalid Drive URL for ${resource.title}`);
      allIds.add(resource.driveFileId);
    }
    const deactivated = await db.sourceFile.updateMany({ where: { provider: 'google_drive', remoteRoot: this.config.remote, remoteFileId: { notIn: [...allIds] }, active: true }, data: { active: false } });
    const selected = resources.filter((resource) => !this.config.courseId || resource.courseId === this.config.courseId).slice(0, this.config.limit);
    const result: IdSyncResult = { catalogResources: resources.length, selected: selected.length, downloaded: 0, indexed: 0, skipped: 0, deactivated: deactivated.count, failed: 0 };
    for (const resource of selected) {
      const course = await db.course.findUnique({ where: { id: resource.courseId } });
      if (!course) { console.error(`Course ${resource.courseId} is missing; seed it before indexing.`); result.failed++; continue; }
      const path = this.pathFor(resource);
      const now = new Date();
      const existing = await db.sourceFile.findUnique({ where: { provider_remoteFileId: { provider: 'google_drive', remoteFileId: resource.driveFileId } }, include: { academicDocument: true } });
      const source = await db.sourceFile.upsert({
        where: { provider_remoteFileId: { provider: 'google_drive', remoteFileId: resource.driveFileId } },
        create: { id: randomUUID(), provider: 'google_drive', remoteRoot: this.config.remote, remoteFileId: resource.driveFileId, remotePath: resource.driveFileId, localPath: `${resource.courseId}/${resource.driveFileId}.pdf`, name: resource.title, size: 0n, modifiedAt: null, courseId: resource.courseId, sourceUrl: resource.sourceUrl, lastSeenAt: now, active: true },
        update: { remoteRoot: this.config.remote, remotePath: resource.driveFileId, localPath: `${resource.courseId}/${resource.driveFileId}.pdf`, name: resource.title, courseId: resource.courseId, sourceUrl: resource.sourceUrl, lastSeenAt: now, active: true }
      });
      try {
        const cached = await existingFile(path);
        const cachedBytes = cached ? await readFile(path) : null;
        const cachedHash = cachedBytes ? createHash('sha256').update(cachedBytes).digest('hex') : null;
        const fresh = Boolean(existing?.lastCheckedAt && now.getTime() - existing.lastCheckedAt.getTime() < this.config.refreshHours * 3600000);
        const intact = cached && cachedHash === existing?.localHash;
        const mustDownload = !intact || !fresh;
        if (mustDownload) { await this.download(resource); result.downloaded++; }
        const bytes = mustDownload ? await readFile(path) : cachedBytes!;
        const hash = createHash('sha256').update(bytes).digest('hex');
        const documentId = `document-${source.id}`;
        const oldMetadata = existing?.academicDocument?.metadata as { indexingKey?: string } | undefined;
        const contentCurrent = existing?.academicDocument?.checksum === hash && oldMetadata?.indexingKey === currentIndexingKey();
        if (contentCurrent && existing?.academicDocumentId === documentId) {
          await db.academicDocument.update({ where: { id: documentId }, data: { title: resource.title, type: resource.type, sourceUrl: resource.sourceUrl } });
          result.skipped++;
        } else {
          const ingested = await ingestPdf({ filePath: path, documentId, courseId: resource.courseId, title: resource.title, type: resource.type, source: 'google_drive', sourceUrl: resource.sourceUrl });
          if (ingested.skipped) result.skipped++;
          else result.indexed++;
        }
        await db.sourceFile.update({ where: { id: source.id }, data: { size: BigInt(bytes.length), mimeType: 'application/pdf', localHash: hash, lastCheckedAt: mustDownload ? now : existing?.lastCheckedAt, indexedAt: now, academicDocumentId: documentId, syncStatus: 'cached', indexStatus: 'indexed', active: true } });
      } catch (error) {
        await db.sourceFile.update({ where: { id: source.id }, data: { syncStatus: 'error', indexStatus: 'error' } });
        result.failed++;
        console.error(`Failed to import Drive ID ${resource.driveFileId}:`, error);
      }
    }
    const rows = await db.sourceFile.findMany({ where: { provider: 'google_drive', remoteRoot: this.config.remote }, orderBy: { remoteFileId: 'asc' } });
    await mkdir(dirname(this.config.manifestPath), { recursive: true });
    const temporary = `${this.config.manifestPath}.tmp`;
    await writeFile(temporary, JSON.stringify({ generatedAt: new Date().toISOString(), files: rows.map(asJson) }, null, 2));
    await rename(temporary, this.config.manifestPath);
    return result;
  }
}
