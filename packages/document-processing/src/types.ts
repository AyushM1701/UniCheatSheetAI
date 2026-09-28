type ResourceType = 'lecture' | 'pyq' | 'solution' | 'assignment' | 'tutorial' | 'other';

export interface ParsedPage { pageNumber: number; text: string }

export interface ParsedDocument {
  title: string;
  filePath: string;
  mimeType: string;
  pages: ParsedPage[];
  metadata?: Record<string, unknown>;
}

export interface SourceFileMetadata {
  driveFileId?: string;
  sourceUrl?: string;
  semester?: number;
  courseId?: string;
  resourceType?: ResourceType;
  documentTitle?: string;
}

export interface DocumentChunk extends SourceFileMetadata {
  id?: string;
  documentId?: string;
  chunkIndex: number;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenEstimate: number;
}

export interface ProcessedDocument {
  title: string;
  filePath: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
  sourceFile?: SourceFileMetadata;
  pages: ParsedPage[];
  chunks: DocumentChunk[];
  status: 'READY_FOR_EMBEDDING';
  pageCount: number;
  extractablePages: number;
  totalCharacters: number;
}
