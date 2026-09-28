import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanText } from './cleaner.js';
import type { ExtractionMethod } from './types.js';

const exec = promisify(execFile);

export interface OCRResult {
  text: string;
  method: Exclude<ExtractionMethod, 'native' | 'none'>;
  confidence?: number;
  lines?: number;
}

export interface OCRProvider {
  recognize(imagePath: string): Promise<OCRResult>;
}

/** A quality heuristic, not a probability that the transcription is correct. */
export function ocrQuality(text: string): number {
  const value = text.trim();
  if (!value) return 0;
  const readable = [...value].filter((char) => /[\p{L}\p{N}\s.,:;!?()\[\]{}+\-=/\\%&@#$^*'"_]/u.test(char)).length / [...value].length;
  const words = value.match(/[\p{L}]{2,}/gu) ?? [];
  const plausible = words.filter((word) => word.length <= 24).length / Math.max(words.length, 1);
  const length = Math.min(value.length / 80, 1);
  return Math.round((readable * 0.4 + plausible * 0.3 + length * 0.3) * 100) / 100;
}

export function tesseractConfidence(tsv: string): number | undefined {
  const rows = tsv.trim().split(/\r?\n/).slice(1);
  const scores = rows.flatMap((row) => {
    const fields = row.split('\t');
    const score = Number(fields[10]);
    return fields.length >= 12 && fields.slice(11).join('\t').trim() && Number.isFinite(score) && score >= 0 ? [score] : [];
  });
  return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) / 100 : undefined;
}

export class TesseractOCR implements OCRProvider {
  async recognize(imagePath: string): Promise<OCRResult> {
    const binary = process.env.OCR_BINARY ?? 'tesseract';
    const language = process.env.OCR_LANG ?? 'eng';
    const options = { timeout: 120000, maxBuffer: 8 * 1024 * 1024 };
    const [plain, tsv] = await Promise.all([
      exec(binary, [imagePath, 'stdout', '-l', language], options),
      exec(binary, [imagePath, 'stdout', '-l', language, 'tsv'], options)
    ]);
    return { text: cleanText(plain.stdout), method: 'tesseract', confidence: tesseractConfidence(tsv.stdout) };
  }
}

export class LocalPythonOCR implements OCRProvider {
  async recognize(imagePath: string): Promise<OCRResult> {
    const script = fileURLToPath(new URL('../../../scripts/ocr_page.py', import.meta.url));
    const { stdout } = await exec(process.env.OCR_PYTHON_BINARY ?? 'python', [script, resolve(imagePath)], { timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string' || !('method' in result) || !['paddleocr', 'trocr', 'tesseract'].includes(String(result.method))) throw new Error('OCR worker returned an invalid result');
    const parsed = result as OCRResult;
    return { text: cleanText(parsed.text), method: parsed.method, ...(typeof parsed.confidence === 'number' && { confidence: parsed.confidence }), ...(typeof parsed.lines === 'number' && { lines: parsed.lines }) };
  }
}

export async function recognizePage(imagePath: string): Promise<OCRResult> {
  const engine = process.env.OCR_ENGINE ?? 'auto';
  if (engine === 'tesseract') return new TesseractOCR().recognize(imagePath);
  if (engine === 'python') return new LocalPythonOCR().recognize(imagePath);
  if (engine !== 'auto') throw new Error(`Unsupported OCR_ENGINE: ${engine}`);
  const baseline = await new TesseractOCR().recognize(imagePath);
  const handwritingThreshold = process.env.OCR_HANDWRITING_ENABLED === 'true' ? 0.8 : 0.55;
  if (ocrQuality(baseline.text) >= 0.73 && (baseline.confidence ?? 0) >= handwritingThreshold) return baseline;
  try {
    const candidate = await new LocalPythonOCR().recognize(imagePath);
    const weakBaseline = (baseline.confidence ?? 0) < 0.65;
    return ocrQuality(candidate.text) > ocrQuality(baseline.text) + 0.08 || (candidate.method === 'trocr' && weakBaseline && candidate.text.length > 30 && ocrQuality(candidate.text) >= ocrQuality(baseline.text) - 0.1) ? candidate : baseline;
  } catch {
    // The optional local handwriting worker may not be installed yet.
    return baseline;
  }
}
