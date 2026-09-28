import { describe, expect, it } from 'vitest';
import { chunkPages, parsePdf } from '../packages/document-processing/src/index.js';
import { LocalEmbeddingProvider } from '../packages/providers/src/index.js';
import { buildApp } from '../apps/api/src/app.js';

describe('sample PDF retrieval inputs', () => {
  it('preserves page numbers and gives matching text a stronger local score', async () => {
    const { pages } = await parsePdf('data/samples/dbms-normalization.pdf');
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
    const chunks = chunkPages(pages);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]?.content).toContain('Normalization');
    expect(chunks[2]?.content).toContain('functional dependency');
    expect(chunks[3]?.content).toContain('INNER JOIN');
    const provider = new LocalEmbeddingProvider();
    const [query, relevant, unrelated] = await provider.embed(['normalization', chunks[0]!.content, 'quantum physics']);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
    expect(dot(query!, relevant!)).toBeGreaterThan(dot(query!, unrelated!));
  });
  it('uses configured chunk sizes while retaining each source page', () => {
    const chunks = chunkPages([{ pageNumber: 7, text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu' }], { maxTokens: 6, overlapTokens: 2 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.page === 7)).toBe(true);
    expect(chunks[0]?.content).toContain('alpha');
    expect(chunks.at(-1)?.content).toContain('mu');
  });
});

describe('API skeleton', () => {
  it('responds to health requests without a database', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'unicheatsheet-ai' });
    await app.close();
  });
  it('rejects invalid retrieve requests before querying', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { query: '' } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
