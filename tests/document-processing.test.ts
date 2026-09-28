import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocument, chunkExamQuestions, cleanText, OcrRequiredError, parseDocument, processDocument } from '../packages/document-processing/src/index.js';

function blankPdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

describe('document processing', () => {
  it('indexes exam questions separately with their original page', () => {
    const chunks = chunkExamQuestions([{ pageNumber: 2, text: 'SECTION A\nQl Define a flip-flop and give one application.\nQ2 Explain a two-input NAND gate using CMOS logic.\nQ3 Draw the circuit.' }], 'Digital Electronics 2024');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ pageStart: 2, pageEnd: 2, chunkIndex: 0 });
    expect(chunks[0]?.content).toContain('Question 1:');
    expect(chunks[1]?.content).toContain('NAND gate');
  });
  it('cleans lightly and keeps chunk page references and source metadata', async () => {
    expect(cleanText(' Database   Management\n\n\nSystems\0 ')).toBe('Database Management\n\nSystems');
    const source = { driveFileId: 'file123', sourceUrl: 'https://drive.google.com/file/d/file123/view', semester: 3, courseId: 'dbms', resourceType: 'lecture' as const, documentTitle: 'DBMS sample' };
    const processed = await processDocument('data/samples/dbms-normalization.pdf', source);
    expect(processed).toMatchObject({ title: 'DBMS sample', pageCount: 4, extractablePages: 4, status: 'READY_FOR_EMBEDDING' });
    expect(processed.chunks).toHaveLength(4);
    expect(processed.chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 1, driveFileId: 'file123', courseId: 'dbms', resourceType: 'lecture' });
    expect(processed.chunks.every((chunk) => chunk.content.length > 0 && chunk.tokenEstimate > 0)).toBe(true);
    const acrossPages = chunkDocument({ title: 'test', filePath: 'test.pdf', mimeType: 'application/pdf', pages: [{ pageNumber: 7, text: 'alpha beta gamma delta epsilon zeta' }, { pageNumber: 8, text: 'eta theta iota kappa lambda mu' }] }, { maxTokens: 4, overlapTokens: 1 });
    expect(acrossPages.every((chunk) => chunk.pageStart === chunk.pageEnd)).toBe(true);
    expect(new Set(acrossPages.map((chunk) => chunk.pageStart))).toEqual(new Set([7, 8]));
  });

  it('rejects unsupported files and flags image-only PDFs for OCR', async () => {
    await expect(parseDocument('notes.docx')).rejects.toThrow('Unsupported file type: .docx');
    const root = await mkdtemp(join(tmpdir(), 'ucs-blank-pdf-'));
    try {
      const path = join(root, 'blank.pdf');
      await writeFile(path, blankPdf());
      await expect(processDocument(path)).rejects.toBeInstanceOf(OcrRequiredError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
