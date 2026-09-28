import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import fg from 'fast-glob';
import { load } from 'cheerio';
import { extractDriveFileId } from './drive-url.js';
import { normalizeResources } from './normalizer.js';
import type { CourseAlias, RawScanReport, ResourceType, ScanReport, ScannedResource } from './types.js';

const PAGE_TYPES: Record<string, ResourceType> = { 'lecture.html': 'lecture', 'solutions.html': 'solution', 'pyqs.html': 'pyq' };

export function getResourceType(filePath: string): ResourceType {
  return PAGE_TYPES[basename(filePath).toLowerCase()] ?? 'other';
}

export function getSemester(filePath: string): number {
  const match = filePath.replaceAll('\\', '/').match(/(?:^|\/)sem(\d+)(?:\/|$)/i);
  if (!match) throw new Error(`Could not determine semester: ${filePath}`);
  return Number(match[1]);
}

export async function scanUniCheatSheet(sourceRoot: string): Promise<RawScanReport> {
  const files = (await fg(['sem*/lecture.html', 'sem*/pyqs.html', 'sem*/solutions.html'], { cwd: sourceRoot, onlyFiles: true, caseSensitiveMatch: false })).sort();
  if (!files.length) throw new Error(`No semester resource pages found in ${sourceRoot}`);
  const resources: ScannedResource[] = [];
  const seen = new Set<string>();
  let anchorsScanned = 0;
  let driveLinks = 0;
  let duplicateIds = 0;
  for (const sourcePage of files) {
    const html = await readFile(join(sourceRoot, sourcePage), 'utf8');
    const $ = load(html);
    const semester = getSemester(sourcePage);
    const type = getResourceType(sourcePage);
    $('a[href]').each((_, anchor) => {
      anchorsScanned++;
      const sourceUrl = $(anchor).attr('href')?.trim() ?? '';
      const driveFileId = extractDriveFileId(sourceUrl);
      if (!driveFileId) return;
      driveLinks++;
      if (seen.has(driveFileId)) { duplicateIds++; return; }
      seen.add(driveFileId);
      const section = $(anchor).closest('section');
      const sectionId = section.attr('id') || undefined;
      const surroundingHeading = section.find('h1,h2,h3,h4,h5,h6').first().text().replace(/\s+/g, ' ').trim() || undefined;
      const title = ($(anchor).find('.hover-text').first().text() || $(anchor).text() || $(anchor).find('img').attr('alt') || 'Untitled resource').replace(/\s+/g, ' ').trim();
      resources.push({ semester, type, title, provider: 'google_drive', driveFileId, sourceUrl, sourcePage: sourcePage.replaceAll('\\', '/'), ...(sectionId && { sectionId }), ...(surroundingHeading && { surroundingHeading }) });
    });
  }
  return { filesScanned: files.length, anchorsScanned, driveLinks, duplicateIds, resources };
}

// Compatibility for callers that need only confidently mapped resources.
export async function scanWebsite(sourceRoot: string, courses: CourseAlias[]): Promise<ScanReport> {
  const raw = await scanUniCheatSheet(sourceRoot);
  const normalized = normalizeResources(raw.resources, courses);
  return { ...raw, resources: normalized.resolved, unresolved: normalized.unresolved };
}
