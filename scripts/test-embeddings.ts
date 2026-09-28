import 'dotenv/config';
import { LocalEmbeddingProvider } from '@ucs/embeddings';

const provider = new LocalEmbeddingProvider();
const texts = [
  'Database normalization reduces redundancy.',
  'Third normal form removes transitive dependency.',
  'AES is a symmetric encryption algorithm.'
];
const vectors = await provider.embed(texts);
for (let index = 0; index < vectors.length; index++) {
  const vector = vectors[index]!;
  const norm = Math.hypot(...vector);
  console.log(`Vector ${index + 1}: ${vector.length} dimensions, norm ${norm.toFixed(4)}`);
}
if (vectors.some((vector) => vector.length !== 384)) throw new Error('Expected 384-dimensional embeddings');
