import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../packages/database/src/index.js';
import { ingestPdf } from '../packages/ingestion/src/index.js';
import { buildApp } from '../apps/api/src/app.js';

process.env.EMBEDDING_PROVIDER = 'local';
process.env.RETRIEVAL_MIN_SCORE = '0.30';

describe('DBMS retrieval against PostgreSQL and pgvector', () => {
  afterAll(async () => { await db.$disconnect(); });

  it('indexes page-linked vectors and retrieves the expected section for each topic', async () => {
    await db.course.upsert({ where: { id: 'dbms' }, create: { id: 'dbms', name: 'Database Management Systems', semester: 3, aliases: ['DBMS', 'database', 'SQL'] }, update: {} });
    const ingested = await ingestPdf({ documentId: 'dbms-normalization-sample', courseId: 'dbms', title: 'DBMS Normalization Sample Notes', type: 'lecture', source: 'sample', filePath: 'data/samples/dbms-normalization.pdf' });
    expect(ingested.pages).toBe(4);
    expect(ingested.chunks).toBe(4);
    const beforeFailure = await db.academicDocument.findUniqueOrThrow({ where: { id: 'dbms-normalization-sample' } });
    const invalidDir = await mkdtemp(join(tmpdir(), 'ucs-failed-revision-'));
    try {
      const invalidPath = join(invalidDir, 'broken.pdf');
      await writeFile(invalidPath, '%PDF-1.4\nnot a valid PDF');
      await expect(ingestPdf({ documentId: 'dbms-normalization-sample', courseId: 'dbms', title: 'Replacement', type: 'lecture', source: 'sample', filePath: invalidPath })).rejects.toThrow();
      const afterFailure = await db.academicDocument.findUniqueOrThrow({ where: { id: 'dbms-normalization-sample' } });
      expect(afterFailure).toMatchObject({ processingStatus: 'indexed', revision: beforeFailure.revision, checksum: beforeFailure.checksum });
      expect(afterFailure.pendingChecksum).not.toBeNull();
      expect(afterFailure.lastFailureAt).not.toBeNull();
    } finally { await rm(invalidDir, { recursive: true, force: true }); }
    const app = buildApp();
    try {
      for (const [query, expectedPage] of [['normalization', 1], ['functional dependency', 3], ['SQL joins', 4]] as const) {
        const response = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query, courseId: 'dbms', source: 'sample', limit: 5 } });
        expect(response.statusCode).toBe(200);
        const hits = response.json().results as Array<{ page: number; document: string; score: number; content: string }>;
        expect(hits[0]?.page, query).toBe(expectedPage);
        expect(hits[0]?.document).toBe('DBMS Normalization Sample Notes');
        expect(hits[0]?.score).toBeGreaterThan(0.08);
        expect(hits[0]?.pageStart).toBe(expectedPage);
        expect(hits[0]?.pageEnd).toBe(expectedPage);
      }
      const paraphrase = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: 'how do we remove duplicate database information', courseId: 'dbms', source: 'sample' } });
      expect(paraphrase.json().results[0]).toMatchObject({ page: 1, courseId: 'dbms', type: 'lecture' });
      const filtered = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: 'normalization', courseId: 'dbms', resourceTypes: ['tutorial'] } });
      expect(filtered.json().results).toEqual([]);
      const unrelated = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: 'AES encryption', courseId: 'dbms', source: 'sample' } });
      expect(unrelated.json().results).toEqual([]);
    } finally {
      await app.close();
      await db.academicDocument.delete({ where: { id: 'dbms-normalization-sample' } });
    }
  });

  it.skipIf(!existsSync('data/samples/dbms/notes.pdf'))('retrieves only topics present in the supplied UniCheatSheet PDF', async () => {
    const ingested = await ingestPdf({ documentId: 'dbms-unicheatsheet-notes', courseId: 'dbms', title: 'UniCheatSheet DBMS PDF', type: 'lecture', source: 'unicheatsheet', filePath: 'data/samples/dbms/notes.pdf' });
    expect(ingested.pages).toBe(97);
    const app = buildApp();
    try {
      const search = async (query: string) => {
        const response = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query, courseId: 'dbms', source: 'unicheatsheet', limit: 5 } });
        expect(response.statusCode).toBe(200);
        return response.json().results as Array<{ page: number; documentId: string; content: string }>;
      };
      expect((await search('SQL joins'))[0]).toMatchObject({ documentId: 'dbms-unicheatsheet-notes' });
      expect((await search('integrity constraints'))[0]).toMatchObject({ documentId: 'dbms-unicheatsheet-notes' });
      expect(await search('AES encryption')).toEqual([]);
    } finally { await app.close(); }
  });
});
