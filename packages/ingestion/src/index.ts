import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { db } from '@ucs/database';
import { OcrRequiredError, chunkExamQuestions, pdfMaxBytes, processDocument } from '@ucs/document-processing';
import { getEmbeddingProvider } from '@ucs/providers';
import { examMetadata, examQuestionFields } from './exam-metadata.js';

export interface IngestPdfInput { filePath: string; courseId: string; documentId: string; title: string; type: string; source?: string; sourceUrl?: string }
export interface IngestResult { documentId: string; pages: number; words: number; chunks: number; embeddings: number; skipped: boolean }
const resourceTypes = ['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other'] as const;
type ResourceType = typeof resourceTypes[number];
function asResourceType(value: string): ResourceType { return resourceTypes.includes(value as ResourceType) ? value as ResourceType : 'other'; }

function chunkSettings() {
  const maxTokens = Number(process.env.CHUNK_SIZE ?? 600);
  const overlapTokens = Number(process.env.CHUNK_OVERLAP ?? 100);
  if (!Number.isInteger(maxTokens) || !Number.isInteger(overlapTokens) || maxTokens < 1 || overlapTokens < 0 || overlapTokens >= maxTokens) throw new Error('CHUNK_SIZE and CHUNK_OVERLAP must be valid integers');
  return { maxTokens, overlapTokens };
}

export function currentIndexingKey(type?: string): string {
  const settings = chunkSettings();
  const config = {
    pipeline: process.env.INGESTION_PIPELINE_VERSION ?? '2026-09-29-v1',
    embedding: getEmbeddingProvider().id,
    dimensions: getEmbeddingProvider().dimensions,
    chunker: 'page-word-v2', ...settings,
    parser: 'pdfjs-v1', pyq: type === 'pyq' ? 'question-v4' : null,
    ocr: process.env.OCR_ENABLED === 'true' ? { engine: process.env.OCR_ENGINE ?? 'auto', language: process.env.OCR_LANG ?? 'eng', dpi: process.env.OCR_RENDER_DPI ?? '275', paddle: process.env.OCR_PADDLE_ENABLED === 'true', handwriting: process.env.OCR_HANDWRITING_ENABLED === 'true', model: process.env.OCR_TROCR_MODEL ?? 'microsoft/trocr-base-handwritten', preprocessing: 'v2' } : 'disabled'
  };
  return `${getEmbeddingProvider().id}:${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;
}

async function fitModelWindow(chunks: Awaited<ReturnType<typeof processDocument>>['chunks'], countTokens?: (text: string) => Promise<number>) {
  if (!countTokens) return chunks;
  const fitted: typeof chunks = [];
  for (const chunk of chunks) {
    if (await countTokens(chunk.content) <= 512) {
      fitted.push({ ...chunk, chunkIndex: fitted.length });
      continue;
    }
    const words = chunk.content.split(/\s+/).filter(Boolean);
    for (let start = 0; start < words.length;) {
      let low = start + 1;
      let high = words.length;
      let end = start;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (await countTokens(words.slice(start, middle).join(' ')) <= 512) { end = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (end === start) throw new Error('One word exceeds the embedding token limit');
      const content = words.slice(start, end).join(' ');
      fitted.push({ ...chunk, chunkIndex: fitted.length, content, tokenEstimate: end - start });
      start = end >= words.length ? end : Math.max(start + 1, end - 30);
    }
  }
  return fitted;
}

export async function ingestPdf(input: IngestPdfInput): Promise<IngestResult> {
  const filePath = resolve(input.filePath);
  if (!filePath.toLowerCase().endsWith('.pdf')) throw new Error('Only PDF files are supported');
  const bytes = await readFile(filePath);
  if (bytes.length > pdfMaxBytes()) throw new Error('PDF exceeds the configured processing limit');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF header');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const provider = getEmbeddingProvider();
  const settings = chunkSettings();
  const indexingKey = currentIndexingKey(input.type);
  const existing = await db.academicDocument.findUnique({ where: { id: input.documentId } });
  const oldMetadata = existing?.metadata as { indexingKey?: string; pages?: number; words?: number } | undefined;
  if (existing?.checksum === checksum && oldMetadata?.indexingKey === indexingKey && existing.processingStatus === 'indexed' && existing.courseId === input.courseId) {
    if (existing.sourceUrl !== (input.sourceUrl ?? null) || existing.title !== input.title || existing.type !== input.type || existing.source !== (input.source ?? 'local') || existing.courseId !== input.courseId) {
      await db.academicDocument.update({ where: { id: input.documentId }, data: { courseId: input.courseId, type: input.type, sourceUrl: input.sourceUrl ?? null, title: input.title, source: input.source ?? 'local', filePath: basename(filePath) } });
    }
    const chunks = await db.documentChunk.count({ where: { documentId: input.documentId } });
    await db.resource.upsert({ where: { id: `local:${input.documentId}` }, create: { id: `local:${input.documentId}`, courseId: input.courseId, resourceType: asResourceType(input.type), title: input.title, contentFormat: 'unknown', academicDocumentId: input.documentId }, update: { courseId: input.courseId, resourceType: asResourceType(input.type), title: input.title, academicDocumentId: input.documentId } });
    return { documentId: input.documentId, pages: existing.pageCount ?? oldMetadata.pages ?? 0, words: oldMetadata.words ?? 0, chunks, embeddings: chunks, skipped: true };
  }
  if (!existing) await db.academicDocument.create({ data: { id: input.documentId, courseId: input.courseId, type: input.type, title: input.title, source: input.source ?? 'local', sourceUrl: input.sourceUrl ?? null, filePath: basename(filePath), checksum, processingStatus: 'parsing' } });
  else await db.academicDocument.update({ where: { id: input.documentId }, data: { pendingChecksum: checksum, lastFailureAt: null, lastFailureReason: null } });
  try {
    const processed = await processDocument(filePath, undefined, settings);
    const words = processed.pages.reduce((total, page) => total + (page.text.match(/\S+/g)?.length ?? 0), 0);
    if (!existing) await db.academicDocument.update({ where: { id: input.documentId }, data: { processingStatus: 'chunking', pageCount: processed.pageCount } });
    const questions = input.type === 'pyq' ? chunkExamQuestions(processed.pages, input.title) : [];
    const chunks = await fitModelWindow(questions.length >= 2 ? questions : processed.chunks, provider.countTokens?.bind(provider));
    if (!existing) await db.academicDocument.update({ where: { id: input.documentId }, data: { processingStatus: 'embedding' } });
    const embeddings: number[][] = [];
    for (let start = 0; start < chunks.length; start += 16) embeddings.push(...await provider.embed(chunks.slice(start, start + 16).map((chunk) => chunk.content)));
    if (embeddings.length !== chunks.length || embeddings.some((vector) => vector.length !== 384 || vector.some((value) => !Number.isFinite(value)))) throw new Error('Embedding dimensions mismatch');
    const metadata = {
      indexingKey, pages: processed.pageCount, words, embeddingDimensions: provider.dimensions,
      pageExtraction: processed.pages.map((page) => ({
        pageNumber: page.pageNumber,
        method: page.extractionMethod ?? 'native',
        ...(page.ocrConfidence !== undefined && { confidence: page.ocrConfidence }),
        needsReview: page.needsReview === true,
        hasLocalImage: Boolean(page.pageImagePath)
      }))
    };
    await db.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId: input.documentId } });
      const paper = input.type === 'pyq' ? examMetadata(input.title) : null;
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]!;
        const chunkId = randomUUID();
        const vector = `[${embeddings[index]!.join(',')}]`;
        const page = processed.pages.find((item) => item.pageNumber === chunk.pageStart);
        const chunkMetadata = JSON.stringify({ extractionMethod: page?.extractionMethod ?? 'native', needsReview: page?.needsReview === true });
        await tx.$executeRaw`INSERT INTO document_chunks (id, document_id, course_id, chunk_index, content, page, page_start, page_end, token_estimate, metadata, embedding) VALUES (${chunkId}, ${input.documentId}, ${input.courseId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.pageStart}, ${chunk.pageStart}, ${chunk.pageEnd}, ${chunk.tokenEstimate}, ${chunkMetadata}::jsonb, ${vector}::vector)`;
        if (paper) await tx.examQuestion.create({ data: { documentId: input.documentId, chunkId, courseId: input.courseId, text: chunk.content, page: chunk.pageStart, needsReview: page?.needsReview === true, ...paper, ...examQuestionFields(chunk.content) } });
      }
      await tx.academicDocument.update({ where: { id: input.documentId }, data: { courseId: input.courseId, type: input.type, title: input.title, source: input.source ?? 'local', sourceUrl: input.sourceUrl ?? null, filePath: basename(filePath), metadata, checksum, pageCount: processed.pageCount, processingStatus: 'indexed', revision: { increment: 1 }, pendingChecksum: null, lastSuccessfulAt: new Date(), lastFailureAt: null, lastFailureReason: null } });
      await tx.resource.upsert({ where: { id: `local:${input.documentId}` }, create: { id: `local:${input.documentId}`, courseId: input.courseId, resourceType: asResourceType(input.type), title: input.title, contentFormat: processed.pages.some((page) => page.extractionMethod && page.extractionMethod !== 'native') ? 'scan' : 'typed', academicDocumentId: input.documentId }, update: { courseId: input.courseId, resourceType: asResourceType(input.type), title: input.title, contentFormat: processed.pages.some((page) => page.extractionMethod && page.extractionMethod !== 'native') ? 'scan' : 'typed', academicDocumentId: input.documentId } });
      await tx.ingestionRun.create({ data: { documentId: input.documentId, status: 'completed', detail: `${chunks.length} chunks and embeddings from ${processed.pageCount} pages` } });
    }, { timeout: 120000 });
    return { documentId: input.documentId, pages: processed.pageCount, words, chunks: chunks.length, embeddings: embeddings.length, skipped: false };
  } catch (error) {
    const status = error instanceof OcrRequiredError ? 'ocr_required' : 'failed';
    await db.academicDocument.update({ where: { id: input.documentId }, data: { ...(!existing ? { processingStatus: status } : {}), pendingChecksum: checksum, lastFailureAt: new Date(), lastFailureReason: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
    await db.ingestionRun.create({ data: { documentId: input.documentId, status, detail: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}
