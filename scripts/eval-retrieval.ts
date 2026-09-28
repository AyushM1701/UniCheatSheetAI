import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';
import { retrieve } from '@ucs/retrieval';

type Case = { query: string; courseId: string; expectedTitleContains?: string; expectedPage?: number; expectNoHits?: boolean };
const cases = JSON.parse(await readFile(process.argv[2] ?? 'evals/retrieval.json', 'utf8')) as Case[];
let passed = 0;
try {
  for (const item of cases) {
    const hits = await retrieve({ query: item.query, courseId: item.courseId, allowedCourseIds: [item.courseId], limit: 8 });
    const match = item.expectNoHits ? hits.length === 0 : hits.some((hit) => (!item.expectedTitleContains || hit.documentTitle.toLowerCase().includes(item.expectedTitleContains.toLowerCase())) && (item.expectedPage === undefined || hit.pageStart === item.expectedPage));
    if (match) passed++;
    console.log(JSON.stringify({ query: item.query, passed: match, top: hits.slice(0, 3).map((hit) => ({ title: hit.documentTitle, page: hit.pageStart, similarity: Number(hit.similarity.toFixed(3)) })) }));
  }
} finally { await db.$disconnect(); }
console.log(`${passed}/${cases.length} retrieval cases passed`);
if (passed !== cases.length) process.exitCode = 1;
