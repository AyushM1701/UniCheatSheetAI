import { env, pipeline } from '@huggingface/transformers';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmbeddingProvider } from './provider.js';

const MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX';
const loadExtractor = () => pipeline('feature-extraction', MODEL, { device: 'cpu' });
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
env.cacheDir = resolve(projectRoot, process.env.HF_MODEL_CACHE_DIR ?? 'data/models/huggingface');

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  readonly id = `${MODEL}:mean-normalized:384`;
  private static extractorPromise: ReturnType<typeof loadExtractor> | null = null;

  async countTokens(text: string): Promise<number> {
    const extractor = await (LocalEmbeddingProvider.extractorPromise ??= loadExtractor());
    return extractor.tokenizer(text, { truncation: false }).input_ids.data.length;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const extractor = await (LocalEmbeddingProvider.extractorPromise ??= loadExtractor());
    for (const value of texts) {
      if (extractor.tokenizer(value, { truncation: false }).input_ids.data.length > 512) throw new Error('Embedding input exceeds the model token limit; split the chunk before indexing');
    }
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const vectors = output.tolist() as number[][];
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions || vector.some((value) => !Number.isFinite(value)))) throw new Error('MiniLM returned invalid embeddings');
    return vectors;
  }
}
