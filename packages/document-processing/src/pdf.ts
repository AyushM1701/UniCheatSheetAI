import { readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanText } from './cleaner.js';
import type { ParsedDocument, ParsedPage } from './types.js';

const exec = promisify(execFile);
async function ocrPage(filePath: string, pageNumber: number): Promise<string> {
  const temp = await mkdtemp(resolve(tmpdir(), 'ucs-ocr-'));
  const relativeTemp = relative(tmpdir(), temp);
  if (!relativeTemp || relativeTemp === '..' || relativeTemp.startsWith(`..${sep}`)) throw new Error('OCR temporary directory escaped the system temp root');
  try {
    const output = resolve(temp, 'page');
    await exec(process.env.PDFTOPPM_BINARY ?? 'pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-r', '220', '-png', '-singlefile', filePath, output], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    const result = await exec(process.env.OCR_BINARY ?? 'tesseract', [`${output}.png`, 'stdout', '-l', process.env.OCR_LANG ?? 'eng'], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return cleanText(result.stdout);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function parsePdf(filePath: string): Promise<ParsedDocument> {
  const absolutePath = resolve(filePath);
  const file = await stat(absolutePath);
  if (!file.isFile() || file.size === 0) throw new Error(`PDF is empty or not a file: ${absolutePath}`);
  if (file.size > 25 * 1024 * 1024) throw new Error('PDF exceeds the 25 MB processing limit');
  const bytes = new Uint8Array(await readFile(absolutePath));
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Invalid PDF header');
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
      if (text.trim().length < 50 && process.env.OCR_ENABLED === 'true') {
        const recovered = await ocrPage(absolutePath, pageNumber);
        if (recovered.trim().length > text.trim().length) text = recovered;
      }
      pages.push({ pageNumber, text });
    }
  } finally { await task.destroy(); }
  return { title: basename(absolutePath), filePath: absolutePath, mimeType: 'application/pdf', pages, metadata: { pageCount: pages.length } };
}
