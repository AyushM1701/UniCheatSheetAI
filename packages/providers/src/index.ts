import { LocalEmbeddingProvider, type EmbeddingProvider } from '@ucs/embeddings';

const local = new LocalEmbeddingProvider();

export { LocalEmbeddingProvider } from '@ucs/embeddings';
export type { EmbeddingProvider } from '@ucs/embeddings';

export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'local';
  if (provider === 'local') return local;
  throw new Error(`Unsupported EMBEDDING_PROVIDER: ${provider}. This database expects 384-dimensional local MiniLM embeddings.`);
}
