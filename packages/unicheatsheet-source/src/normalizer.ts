import type { CourseAlias, ScannedResource, WebsiteResource } from './types.js';

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function normalizeResources(raw: ScannedResource[], courses: CourseAlias[]): { resources: ScannedResource[]; resolved: WebsiteResource[]; unresolved: ScannedResource[] } {
  const resources: ScannedResource[] = [];
  const resolved: WebsiteResource[] = [];
  const unresolved: ScannedResource[] = [];
  for (const item of raw) {
    const findMatches = (candidate?: string) => candidate ? courses.filter((course) => (course.semester === undefined || course.semester === item.semester) && [course.id, course.name, ...(course.aliases ?? [])].some((name) => key(name) === key(candidate))) : [];
    const headingMatches = findMatches(item.surroundingHeading);
    const matches = headingMatches.length ? headingMatches : findMatches(item.sectionId);
    if (matches.length !== 1) {
      resources.push(item);
      unresolved.push(item);
      continue;
    }
    const course = matches[0]!;
    const normalized = { ...item, courseId: course.id, courseName: course.name };
    resources.push(normalized);
    resolved.push({ semester: item.semester, courseId: course.id, courseName: course.name, type: item.type, title: item.title, provider: 'google_drive', driveFileId: item.driveFileId, sourceUrl: item.sourceUrl, originFile: item.sourcePage });
  }
  return { resources, resolved, unresolved };
}
