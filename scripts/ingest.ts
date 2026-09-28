import 'dotenv/config';
import { basename, extname, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { db } from '@ucs/database';
import { ingestPdf } from '@ucs/ingestion';

const [argument, ...flags] = process.argv.slice(2);
const option = (name: string) => { const index = flags.indexOf(name); return index >= 0 ? flags[index + 1] : undefined; };
const resources = JSON.parse(await readFile(new URL('../catalog/local-resources.json', import.meta.url), 'utf8')) as Array<{ id: string; courseId: string; type: string; title: string; filePath: string; source?: string }>;
const isPath = Boolean(argument && (argument.toLowerCase().endsWith('.pdf') || argument.includes('/') || argument.includes('\\')));
const catalogMatch = isPath ? resources.find((resource) => resolve(resource.filePath).toLowerCase() === resolve(argument!).toLowerCase()) : undefined;
const selected = isPath ? [{
  id: option('--id') ?? catalogMatch?.id ?? `dbms-${basename(argument!, extname(argument!)).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  courseId: option('--course') ?? catalogMatch?.courseId ?? 'dbms',
  type: option('--type') ?? catalogMatch?.type ?? 'lecture',
  title: option('--title') ?? catalogMatch?.title ?? basename(argument!, extname(argument!)),
  filePath: argument!,
  source: option('--source') ?? catalogMatch?.source ?? 'local'
}] : resources.filter((resource) => !argument || resource.id === argument);
if (!selected.length) throw new Error(`Unknown resource: ${argument}`);
try {
  for (const resource of selected) {
    const filePath = resolve(resource.filePath);
    if (!(await stat(filePath)).isFile()) throw new Error(`Not a file: ${filePath}`);
    console.log(`Reading: ${basename(filePath)}`);
    const result = await ingestPdf({ documentId: resource.id, courseId: resource.courseId, title: resource.title, type: resource.type, source: resource.source ?? 'local', filePath });
    console.log(`Pages found: ${result.pages}`);
    console.log(`Text extracted: ${result.words.toLocaleString()} words`);
    console.log(`Chunks generated: ${result.chunks}`);
    console.log(`Document ${result.skipped ? 'unchanged (skipped)' : 'stored: ✓'}`);
  }
} finally {
  await db.$disconnect();
}
