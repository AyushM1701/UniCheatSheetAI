import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';

type ResourceType = 'lecture' | 'pyq' | 'solution' | 'tutorial' | 'assignment' | 'book' | 'syllabus' | 'announcement' | 'other';
type ContentFormat = 'typed' | 'handwritten' | 'mixed' | 'scan' | 'unknown';
type CatalogItem = {
  id?: string; courseId: string; resourceType?: ResourceType; type?: ResourceType; title: string;
  unit?: string; sortOrder?: number; contentFormat?: ContentFormat; active?: boolean;
  sourceProvider?: string; sourceAssetId?: string; driveFileId?: string; sourceUrl?: string; sourcePage?: string;
  examType?: string; year?: number; month?: string; program?: string;
};
const resourceTypes = new Set<ResourceType>(['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other']);
const formats = new Set<ContentFormat>(['typed', 'handwritten', 'mixed', 'scan', 'unknown']);
const path = process.argv[2] ?? 'catalog/folder-resources.json';
const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
if (!Array.isArray(raw)) throw new Error('Resource catalog must be an array');
let imported = 0;
let linked = 0;
try {
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== 'object') throw new Error(`Catalog item ${index + 1} is invalid`);
    const item = value as CatalogItem;
    if (process.env.RESOURCE_CATALOG_REQUIRE_IDS === 'true' && !item.id) throw new Error(`Catalog item ${index + 1} is missing a canonical resource ID`);
    const type = item.resourceType ?? item.type;
    const assetId = item.sourceAssetId ?? item.driveFileId;
    if (!item.courseId || !item.title || !type || !resourceTypes.has(type) || item.contentFormat && !formats.has(item.contentFormat)) throw new Error(`Catalog item ${index + 1} has invalid course, title, type, or format`);
    if (!await db.course.findUnique({ where: { id: item.courseId }, select: { id: true } })) throw new Error(`Unknown course ID ${item.courseId}; import canonical courses before resources`);
    const legacyId = `local-catalog:${createHash('sha256').update(`${item.courseId}:${type}:${assetId ?? item.title}`).digest('hex').slice(0, 24)}`;
    const id = item.id ?? `local-catalog:${createHash('sha256').update(`${item.courseId}:${type}:${assetId ?? ''}:${item.title}:${item.sourcePage ?? ''}`).digest('hex').slice(0, 24)}`;
    const source = assetId ? await db.sourceFile.findFirst({ where: { provider: item.sourceProvider ?? 'google_drive', remoteFileId: assetId, courseId: item.courseId }, select: { academicDocumentId: true } }) : null;
    const document = source?.academicDocumentId ? { id: source.academicDocumentId } : await db.academicDocument.findFirst({ where: { courseId: item.courseId, type, ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : { title: item.title }) }, select: { id: true } });
    const data = {
      courseId: item.courseId, resourceType: type, title: item.title, unit: item.unit ?? null,
      sortOrder: item.sortOrder ?? 0, contentFormat: item.contentFormat ?? 'unknown' as ContentFormat,
      active: item.active !== false, sourceProvider: item.sourceProvider ?? 'google_drive',
      sourceAssetId: assetId ?? null, academicDocumentId: document?.id ?? null,
      metadata: { provisional: !item.id, ...(item.examType ? { examType: item.examType } : {}), ...(item.year ? { year: item.year } : {}), ...(item.month ? { month: item.month } : {}), ...(item.program ? { program: item.program } : {}) }
    };
    await db.resource.upsert({ where: { id }, create: { id, ...data }, update: data });
    if (legacyId !== id) await db.resource.updateMany({ where: { id: legacyId }, data: { active: false } });
    if (document && !id.startsWith('local:')) await db.resource.updateMany({ where: { academicDocumentId: document.id, id: { startsWith: 'local:' } }, data: { active: false } });
    imported++;
    if (document) linked++;
  }
  console.log(JSON.stringify({ imported, linked, unlinked: imported - linked, provisionalIds: raw.filter((item) => !item.id).length }));
} finally { await db.$disconnect(); }
