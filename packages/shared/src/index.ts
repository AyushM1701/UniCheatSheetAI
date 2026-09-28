import { z } from 'zod';

export const retrieveSchema = z.object({
  query: z.string().trim().min(2).max(2000),
  courseId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1).optional(),
  resourceId: z.string().trim().min(1).optional(),
  allowedCourseIds: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  semester: z.number().int().min(1).max(12).optional(),
  type: z.enum(['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other']).optional(),
  resourceTypes: z.array(z.enum(['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other'])).min(1).max(9).optional(),
  limit: z.number().int().min(1).max(20).default(8)
}).strict();
export type RetrieveRequest = z.infer<typeof retrieveSchema>;

export const chatSchema = z.object({
  message: z.string().trim().min(2).max(4000),
  conversationId: z.string().uuid().nullable().optional(),
  mode: z.enum(['auto', 'notes', 'pyqs', 'solutions', 'practice']).optional(),
  scope: z.object({ semester: z.number().int().min(1).max(12).optional(), courseId: z.string().trim().min(1).optional(), resourceId: z.string().trim().min(1).optional(), documentId: z.string().trim().min(1).optional(), resourceTypes: z.array(z.enum(['lecture', 'pyq', 'solution', 'tutorial', 'assignment', 'book', 'syllabus', 'announcement', 'other'])).min(1).max(9).optional() }).strict().optional()
}).strict();
export type ChatRequest = z.infer<typeof chatSchema>;

export interface ParsedPage { pageNumber: number; text: string }
export interface ChunkInput { chunkIndex: number; content: string; page: number; section?: string }
export interface EmbeddingProvider { readonly dimensions: number; readonly id: string; embed(texts: string[]): Promise<number[][]> }
