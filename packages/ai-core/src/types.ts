import type { RetrievalHit } from '@ucs/retrieval';
import type { ChatRequest } from '@ucs/shared';
export type ChatInput = ChatRequest;
export type QueryIntent = 'academic_rag' | 'resource_search' | 'database_query' | 'practice_generation' | 'general_chat';
export interface Citation { id: string; documentId: string; chunkId: string; documentTitle: string; courseId: string; page: number | null; pageStart: number | null; pageEnd: number | null; sourceUrl: string | null; excerpt?: string }
export interface ChatResult { conversationId: string; answer: string; citations: Citation[]; metadata: { courseId: string | null; intent: QueryIntent; retrievedChunks: number; provider: string } }
export interface CitedSource { id: string; hit: RetrievalHit; citation: Citation }
