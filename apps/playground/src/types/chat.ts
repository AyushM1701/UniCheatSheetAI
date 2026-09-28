export type ChatStatus = 'idle' | 'retrieving' | 'generating' | 'complete' | 'error';
export type ChatMode = 'auto' | 'notes' | 'pyqs' | 'solutions' | 'practice';
export interface ChatScope { semester?: number; courseId?: string; resourceId?: string; documentId?: string; resourceTypes?: string[]; sources: Array<'unicheatsheet' | 'lms'> }
export interface Course { id: string; code?: string | null; name: string; semester: number; aliases: string[] }
export interface UserAcademicContext { accountKey: string; semester: number; allowedCourses: Array<{ id: string; name: string }>; currentCourseId?: string | null; resourceAvailability?: Record<string, string[]> }
export interface CoverageItem { courseId: string; type: string; count: number; lastIndexedAt: string | null }
export interface AcademicResource { id: string; courseId: string; courseName: string; resourceType: string; title: string; unit: string | null; contentFormat: string; documentId: string | null; indexed: boolean; pageCount: number | null }
export interface Citation { id: string; documentId: string; resourceId?: string | null; chunkId: string; documentTitle: string; courseId?: string; courseName?: string; resourceType?: string; unit?: string | null; contentFormat?: string | null; extractionMethod?: string; needsReview?: boolean; page: number | null; pageStart: number | null; pageEnd: number | null; sourceUrl: string | null; excerpt?: string }
export type AnswerProvenance = 'grounded' | 'mixed' | 'general' | 'insufficient';
export interface ChatResult { conversationId: string; answer: string; citations: Citation[]; metadata: { courseId: string | null; intent: string; retrievedChunks: number; provider: string; model: string | null; provenance: AnswerProvenance; sourceSupportVerified: boolean } }
export interface StoredMessage { id: string; role: string; content: string; citations: Citation[]; createdAt: string }
export interface Conversation { id: string; title: string | null; courseId: string | null; semester: number | null; createdAt: string; updatedAt: string; messages: StoredMessage[] }
export interface ConversationSummary { id: string; title: string | null; createdAt: string; updatedAt: string }
export interface SourceDetail { id: string; content: string; pageStart: number | null; pageEnd: number | null; extractionMethod?: string; needsReview?: boolean; pageImageUrl?: string | null; document: { title: string; sourceUrl: string | null; type: string; course: { id: string; name: string } } }
export interface UIMessage { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; provenance?: AnswerProvenance; pending?: boolean }
