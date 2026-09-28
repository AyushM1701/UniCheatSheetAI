export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
  countTokens?(text: string): Promise<number>;
}
