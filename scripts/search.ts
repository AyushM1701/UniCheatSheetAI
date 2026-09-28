import 'dotenv/config';
import { db } from '@ucs/database';
import { retrieve } from '@ucs/retrieval';
import { retrieveSchema } from '@ucs/shared';

const [query, ...flags] = process.argv.slice(2);
if (!query) throw new Error('Usage: pnpm search "query" [--course dbms] [--type pyq] [--limit 5]');
const option = (name: string) => { const index = flags.indexOf(name); return index >= 0 ? flags[index + 1] : undefined; };
const limit = Number(option('--limit') ?? 5);
const input = retrieveSchema.parse({ query, ...(option('--course') && { courseId: option('--course') }), ...(option('--type') && { type: option('--type') }), ...(option('--source') && { source: option('--source') }), ...(option('--semester') && { semester: Number(option('--semester')) }), limit });
try {
  const hits = await retrieve(input);
  console.log(`Query: ${input.query}`);
  if (!hits.length) console.log('No sufficiently relevant material found.');
  for (const [index, hit] of hits.entries()) {
    console.log(`\n#${index + 1}  Similarity: ${hit.similarity.toFixed(3)}`);
    console.log(`${hit.title} · ${hit.courseId} · ${hit.type} · page ${hit.pageStart ?? hit.page ?? '?'}`);
    if (hit.sourceUrl) console.log(hit.sourceUrl);
    console.log(hit.content.slice(0, 500));
  }
} finally { await db.$disconnect(); }
