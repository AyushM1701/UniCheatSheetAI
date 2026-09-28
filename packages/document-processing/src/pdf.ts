import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanText } from './cleaner.js';
import { pdfMaxBytes } from './limits.js';
import { nativeTextNeedsOcr, ocrQuality, recognizePage } from './ocr.js';
import type { ParsedDocument, ParsedPage } from './types.js';

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
async function renderOcrPage(filePath: string, checksum: string, pageNumber: number): Promise<string> {
  const directory = resolve(projectRoot, process.env.PAGE_IMAGE_DIR ?? 'data/processing/page-images', checksum);
  await mkdir(directory, { recursive: true });
  const imagePath = join(directory, `page-${pageNumber}.png`);
  try { if ((await stat(imagePath)).size > 0) return imagePath; } catch { /* Render missing page. */ }
  const temporaryBase = join(directory, `.page-${pageNumber}-${randomUUID()}`);
  const dpi = Number(process.env.OCR_RENDER_DPI ?? 275);
  if (!Number.isInteger(dpi) || dpi < 150 || dpi > 400) throw new Error('OCR_RENDER_DPI must be between 150 and 400');
  try {
    await exec(process.env.PDFTOPPM_BINARY ?? 'pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-r', String(dpi), '-png', '-singlefile', filePath, temporaryBase], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    await rename(`${temporaryBase}.png`, imagePath);
    return imagePath;
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(`${temporaryBase}.png`, { force: true });
    throw error;
  }
}

export async function parsePdf(filePath: string): Promise<ParsedDocument> {
  const absolutePath = resolve(filePath);
  const file = await stat(absolutePath);
  if (!file.isFile() || file.size === 0) throw new Error(`PDF is empty or not a file: ${absolutePath}`);
  if (file.size > pdfMaxBytes()) throw new Error('PDF exceeds the configured processing limit');
  const bytes = new Uint8Array(await readFile(absolutePath));
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Invalid PDF header');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const task = getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true });
  const pdf = await task.promise;
  const pages: ParsedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let current = '';
      let lastY: number | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 2 && current) { lines.push(current); current = ''; }
        current += `${item.str} `;
        lastY = y;
      }
      if (current) lines.push(current);
      let text = cleanText(lines.join('\n'));
      let extractionMethod: ParsedPage['extractionMethod'] = text ? 'native' : 'none';
      let pageImagePath: string | undefined;
      let ocrConfidence: number | undefined;
      let needsReview = false;
      if (nativeTextNeedsOcr(text) && process.env.OCR_ENABLED === 'true') {
        pageImagePath = await renderOcrPage(absolutePath, checksum, pageNumber);
        const recovered = await recognizePage(pageImagePath);
        if (ocrQuality(recovered.text) > ocrQuality(text) || (text.trim().length < 50 && recovered.text.trim().length > text.trim().length)) {
          text = recovered.text;
          extractionMethod = recovered.method;
          ocrConfidence = recovered.confidence;
        }
        needsReview = text.trim().length < 50 || ocrQuality(text) < 0.65 || extractionMethod === 'trocr' || (extractionMethod === 'tesseract' && (ocrConfidence === undefined || ocrConfidence < 0.8));
      }
      pages.push({ pageNumber, text, extractionMethod, ...(pageImagePath && { pageImagePath }), ...(ocrConfidence !== undefined && { ocrConfidence }), ...(needsReview && { needsReview }) });
    }
  } finally { await task.destroy(); }
  return { title: basename(absolutePath), filePath: absolutePath, mimeType: 'application/pdf', pages, metadata: { pageCount: pages.length } };
}
