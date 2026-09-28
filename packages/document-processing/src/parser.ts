import { extname } from 'node:path';
import { chunkDocument, type ChunkOptions } from './chunker.js';
import { parsePdf } from './pdf.js';
import type { ParsedDocument, ProcessedDocument, SourceFileMetadata } from './types.js';

export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.pdf') return parsePdf(filePath);
  throw new Error(`Unsupported file type: ${extension || '(none)'}`);
}

export class OcrRequiredError extends Error {
  readonly status = 'OCR_REQUIRED';
  constructor(message = 'Document contains little or no extractable text; OCR is required') { super(message); }
}

export async function processDocument(filePath: string, sourceFile?: SourceFileMetadata, options: ChunkOptions = {}): Promise<ProcessedDocument> {
  const document = await parseDocument(filePath);
  if (!document.pages.length) throw new Error('Document has no pages');
  const totalCharacters = document.pages.reduce((total, page) => total + page.text.trim().length, 0);
  if (totalCharacters < 50) throw new OcrRequiredError();
  const chunks = chunkDocument(document, options, sourceFile);
  if (!chunks.length) throw new OcrRequiredError('Document produced no text chunks; OCR is required');
  return {
    title: sourceFile?.documentTitle ?? document.title,
    filePath: document.filePath,
    mimeType: document.mimeType,
    ...(document.metadata && { metadata: document.metadata }),
    ...(sourceFile && { sourceFile }),
    pages: document.pages,
    chunks,
    status: 'READY_FOR_EMBEDDING',
    pageCount: document.pages.length,
    extractablePages: document.pages.filter((page) => page.text.trim().length > 0).length,
    totalCharacters
  };
}
