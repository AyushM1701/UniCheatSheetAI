import type { ChunkInput } from '@ucs/shared';
import { cleanText } from './cleaner.js';
import type { DocumentChunk, ParsedDocument, ParsedPage, SourceFileMetadata } from './types.js';

export interface ChunkOptions { maxTokens?: number; overlapTokens?: number }

function estimatedTokens(word: string): number { return Math.max(1, Math.ceil(word.length / 4)); }

export function chunkPages(pages: ParsedPage[], options: ChunkOptions = {}): ChunkInput[] {
  const maxTokens = options.maxTokens ?? 600;
  const overlapTokens = options.overlapTokens ?? 100;
  if (!Number.isInteger(maxTokens) || !Number.isInteger(overlapTokens) || maxTokens < 1 || overlapTokens < 0 || overlapTokens >= maxTokens) throw new Error('Invalid chunk settings');
  const result: ChunkInput[] = [];
  for (const page of pages) {
    const paragraphs = cleanText(page.text).split(/\n\s*\n|\n(?=[A-Z][^\n]{2,80}$)/).filter(Boolean);
    const words = paragraphs.flatMap((part) => part.split(/\s+/).filter(Boolean));
    for (let start = 0; start < words.length;) {
      let end = start;
      let tokens = 0;
      while (end < words.length && (tokens + estimatedTokens(words[end]!) <= maxTokens || end === start)) {
        tokens += estimatedTokens(words[end]!);
        end++;
      }
      const content = words.slice(start, end).join(' ');
      if (content) result.push({ chunkIndex: result.length, content, page: page.pageNumber });
      if (end >= words.length) break;
      let overlap = 0;
      let next = end;
      while (next > start + 1 && overlap + estimatedTokens(words[next - 1]!) <= overlapTokens) {
        next--;
        overlap += estimatedTokens(words[next]!);
      }
      start = next;
    }
  }
  return result;
}

export function chunkDocument(document: ParsedDocument, options: ChunkOptions = {}, sourceFile?: SourceFileMetadata): DocumentChunk[] {
  return chunkPages(document.pages, options).map((chunk) => ({
    ...sourceFile,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    pageStart: chunk.page,
    pageEnd: chunk.page,
    tokenEstimate: chunk.content.split(/\s+/).reduce((total, word) => total + estimatedTokens(word), 0)
  }));
}
