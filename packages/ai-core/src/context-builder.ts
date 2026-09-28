import type { RetrievalHit } from '@ucs/retrieval';
import type { CitedSource } from './types.js';
export function buildContext(hits: RetrievalHit[]): CitedSource[] {
  return hits.slice(0, 6).map((hit, index) => {
    const id = `S${index + 1}`;
    return { id, hit, citation: { id, documentId: hit.documentId, resourceId: hit.resourceId, chunkId: hit.chunkId, documentTitle: hit.documentTitle, courseId: hit.courseId, courseName: hit.courseName, resourceType: hit.type, unit: hit.unit, contentFormat: hit.contentFormat, extractionMethod: hit.extractionMethod, needsReview: hit.needsReview, page: hit.page, pageStart: hit.pageStart, pageEnd: hit.pageEnd, sourceUrl: hit.sourceUrl, excerpt: hit.content } };
  });
}
export function formatSources(sources: CitedSource[]): string {
  return sources.map(({ id, hit }) => `[${id}]\nTitle: ${hit.documentTitle}\nOrigin: ${hit.source}\nType: ${hit.type}\nPage: ${hit.pageStart ?? hit.page ?? 'unknown'}\nExtraction: ${hit.extractionMethod}${hit.needsReview ? ' (uncertain OCR; equations and symbols may be wrong)' : ''}\nContent: ${hit.content}`).join('\n\n') + '\nEND SOURCES';
}
