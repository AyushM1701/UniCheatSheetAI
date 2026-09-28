import type { RetrievalHit } from '@ucs/retrieval';
import type { ChatRequest } from '@ucs/shared';
export type ChatInput = ChatRequest;
export type QueryIntent = 'academic_rag' | 'resource_search' | 'database_query' | 'practice_generation' | 'general_chat';
export type AnswerProvenance = 'grounded' | 'mixed' | 'general' | 'insufficient';
export interface Citation { id: string; documentId: string; resourceId: string | null; chunkId: string; documentTitle: string; courseId: string; courseName: string; resourceType: string; unit: string | null; contentFormat: string | null; extractionMethod: string; needsReview: boolean; page: number | null; pageStart: number | null; pageEnd: number | null; sourceUrl: string | null; excerpt?: string }
export interface ChatResult { conversationId: string; answer: string; citations: Citation[]; metadata: { courseId: string | null; intent: QueryIntent; retrievedChunks: number; provider: string; model: string | null; provenance: AnswerProvenance; sourceSupportVerified: boolean } }
export interface CitedSource { id: string; hit: RetrievalHit; citation: Citation }
