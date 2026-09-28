import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { OcrRequiredError, processDocument, type SourceFileMetadata } from '@ucs/document-processing';
import { validateResources } from '@ucs/unicheatsheet-source';

const filePath = process.argv[2];
if (!filePath) throw new Error('Provide a cached PDF path: pnpm test:parse "data/drive-cache/.../file.pdf"');
const absolutePath = resolve(filePath);
const manifestPath = process.env.DRIVE_MANIFEST_PATH ?? 'data/manifests/drive-sync.json';
const catalogPath = process.env.DRIVE_CATALOG_PATH ?? 'catalog/resources.json';

async function optionalJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const manifest = await optionalJson(manifestPath) as { resources?: Record<string, { localPath: string; originalName: string }> } | undefined;
const cached = Object.entries(manifest?.resources ?? {}).find(([, item]) => resolve(item.localPath) === absolutePath);
const catalogRaw = await optionalJson(catalogPath);
const catalog = catalogRaw ? validateResources(catalogRaw) : [];
const resource = catalog.find((item) => item.driveFileId === cached?.[0]);
const sourceFile: SourceFileMetadata | undefined = cached ? {
  driveFileId: cached[0],
  ...(resource?.sourceUrl && { sourceUrl: resource.sourceUrl }),
  ...(resource?.semester && { semester: resource.semester }),
  ...(resource?.courseId && { courseId: resource.courseId }),
  ...(resource?.type && { resourceType: resource.type }),
  documentTitle: resource?.title ?? cached[1].originalName
} : undefined;

console.log(`Processing: ${basename(absolutePath)}`);
try {
  const result = await processDocument(absolutePath, sourceFile, { maxTokens: Number(process.env.CHUNK_SIZE ?? 600), overlapTokens: Number(process.env.CHUNK_OVERLAP ?? 100) });
  console.log(`Document: ${result.title}`);
  console.log(`Pages: ${result.pageCount}`);
  console.log(`Extractable pages: ${result.extractablePages}`);
  console.log(`Chunks: ${result.chunks.length}`);
  for (const chunk of result.chunks.slice(0, 3)) {
    console.log(`\n--- CHUNK ${chunk.chunkIndex} · PAGE ${chunk.pageStart} ---`);
    console.log(chunk.content.slice(0, 700));
  }
  const outputName = sourceFile?.driveFileId ?? basename(absolutePath).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const output = join(process.env.PROCESSING_DIR ?? 'data/processing', `${outputName}.json`);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(`Status: ${result.status}`);
  console.log(`Processed JSON: ${output}`);
} catch (error) {
  if (error instanceof OcrRequiredError) { console.error(`Status: ${error.status} — ${error.message}`); process.exitCode = 2; }
  else throw error;
}
