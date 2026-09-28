import { cleanText } from './cleaner.js';
import type { DocumentChunk, ParsedPage } from './types.js';

/** Split papers at visible question labels, retaining their original PDF page. */
export function chunkExamQuestions(pages: ParsedPage[], title: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const page of pages) {
    const text = page.text;
    const pattern = /^\s*Q(?:uestion)?\.?\s*(\d{1,2}|ll|l|I{1,2})(?=[\s).:])/gim;
    const starts = [...text.matchAll(pattern)];
    if (starts.length < 2) continue;
    for (let index = 0; index < starts.length; index++) {
      const start = starts[index]!;
      const end = starts[index + 1]?.index ?? text.length;
      const number = /^(?:l|I)$/i.test(start[1]!) ? '1' : /^ll$/i.test(start[1]!) ? '11' : start[1]!;
      const body = cleanText(text.slice(start.index, end)).replace(/\s+/g, ' ').trim();
      if (body.length < 20) continue;
      const content = `${title}. Question ${number}: ${body}`;
      chunks.push({ chunkIndex: chunks.length, content, pageStart: page.pageNumber, pageEnd: page.pageNumber, tokenEstimate: Math.ceil(content.length / 4) });
    }
  }
  return chunks;
}
