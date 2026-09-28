import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { db } from '@ucs/database';
import { OcrRequiredError, chunkExamQuestions, processDocument } from '@ucs/document-processing';
import { getEmbeddingProvider } from '@ucs/providers';

export interface IngestPdfInput { filePath: string; courseId: string; documentId: string; title: string; type: string; source?: string; sourceUrl?: string }
export interface IngestResult { documentId: string; pages: number; words: number; chunks: number; embeddings: number; skipped: boolean }

function chunkSettings() {
  const maxTokens = Number(process.env.CHUNK_SIZE ?? 600);
  const overlapTokens = Number(process.env.CHUNK_OVERLAP ?? 100);
  if (!Number.isInteger(maxTokens) || !Number.isInteger(overlapTokens) || maxTokens < 1 || overlapTokens < 0 || overlapTokens >= maxTokens) throw new Error('CHUNK_SIZE and CHUNK_OVERLAP must be valid integers');
  return { maxTokens, overlapTokens };
}

export function currentIndexingKey(): string {
  const settings = chunkSettings();
  return `${getEmbeddingProvider().id}:${settings.maxTokens}:${settings.overlapTokens}:token-aware-v2`;
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
      start = end;
    }
  }
  return fitted;
}

export async function ingestPdf(input: IngestPdfInput): Promise<IngestResult> {
  const filePath = resolve(input.filePath);
  if (!filePath.toLowerCase().endsWith('.pdf')) throw new Error('Only PDF files are supported');
  const bytes = await readFile(filePath);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('PDF exceeds 25 MB');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF header');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const provider = getEmbeddingProvider();
  const settings = chunkSettings();
  const indexingKey = currentIndexingKey();
  const existing = await db.academicDocument.findUnique({ where: { id: input.documentId } });
  const oldMetadata = existing?.metadata as { indexingKey?: string; pages?: number; words?: number } | undefined;
  if (existing?.checksum === checksum && oldMetadata?.indexingKey === indexingKey && existing.processingStatus === 'indexed' && existing.courseId === input.courseId) {
    if (existing.sourceUrl !== (input.sourceUrl ?? null) || existing.title !== input.title || existing.type !== input.type || existing.source !== (input.source ?? 'local') || existing.courseId !== input.courseId) {
      await db.academicDocument.update({ where: { id: input.documentId }, data: { courseId: input.courseId, type: input.type, sourceUrl: input.sourceUrl ?? null, title: input.title, source: input.source ?? 'local', filePath: basename(filePath) } });
    }
    const chunks = await db.documentChunk.count({ where: { documentId: input.documentId } });
    return { documentId: input.documentId, pages: existing.pageCount ?? oldMetadata.pages ?? 0, words: oldMetadata.words ?? 0, chunks, embeddings: chunks, skipped: true };
  }
  if (!existing) await db.academicDocument.create({ data: { id: input.documentId, courseId: input.courseId, type: input.type, title: input.title, source: input.source ?? 'local', sourceUrl: input.sourceUrl ?? null, filePath: basename(filePath), checksum, processingStatus: 'parsing' } });
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
    const metadata = { indexingKey, pages: processed.pageCount, words, embeddingDimensions: provider.dimensions };
    await db.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId: input.documentId } });
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]!;
        const vector = `[${embeddings[index]!.join(',')}]`;
        await tx.$executeRaw`INSERT INTO document_chunks (id, document_id, course_id, chunk_index, content, page, page_start, page_end, token_estimate, embedding) VALUES (${randomUUID()}, ${input.documentId}, ${input.courseId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.pageStart}, ${chunk.pageStart}, ${chunk.pageEnd}, ${chunk.tokenEstimate}, ${vector}::vector)`;
      }
      await tx.academicDocument.update({ where: { id: input.documentId }, data: { courseId: input.courseId, type: input.type, title: input.title, source: input.source ?? 'local', sourceUrl: input.sourceUrl ?? null, filePath: basename(filePath), metadata, checksum, pageCount: processed.pageCount, processingStatus: 'indexed' } });
      await tx.ingestionRun.create({ data: { documentId: input.documentId, status: 'completed', detail: `${chunks.length} chunks and embeddings from ${processed.pageCount} pages` } });
    }, { timeout: 120000 });
    return { documentId: input.documentId, pages: processed.pageCount, words, chunks: chunks.length, embeddings: embeddings.length, skipped: false };
  } catch (error) {
    const status = error instanceof OcrRequiredError ? 'ocr_required' : 'failed';
    if (!existing) await db.academicDocument.update({ where: { id: input.documentId }, data: { processingStatus: status } });
    await db.ingestionRun.create({ data: { documentId: input.documentId, status, detail: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}
