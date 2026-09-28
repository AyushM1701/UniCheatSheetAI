import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanText } from './cleaner.js';
import type { ParsedDocument, ParsedPage } from './types.js';

export async function parsePdf(filePath: string): Promise<ParsedDocument> {
  const absolutePath = resolve(filePath);
  const file = await stat(absolutePath);
  if (!file.isFile() || file.size === 0) throw new Error(`PDF is empty or not a file: ${absolutePath}`);
  if (file.size > 25 * 1024 * 1024) throw new Error('PDF exceeds the 25 MB processing limit');
  const bytes = new Uint8Array(await readFile(absolutePath));
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Invalid PDF header');
  const pdf = await getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise;
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
      pages.push({ pageNumber, text: cleanText(lines.join('\n')) });
    }
  } finally { await pdf.destroy(); }
  return { title: basename(absolutePath), filePath: absolutePath, mimeType: 'application/pdf', pages, metadata: { pageCount: pages.length } };
}
