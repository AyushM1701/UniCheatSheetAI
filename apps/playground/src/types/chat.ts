export type ChatStatus = 'idle' | 'retrieving' | 'generating' | 'complete' | 'error';
export interface ChatScope { semester?: number; courseId?: string; sources: Array<'unicheatsheet' | 'lms'> }
export interface Course { id: string; code?: string | null; name: string; semester: number; aliases: string[] }
export interface UserAcademicContext { semester: number; allowedCourses: Array<{ id: string; name: string }>; currentCourseId?: string | null }
export interface Citation { id: string; documentId: string; chunkId: string; documentTitle: string; courseId?: string; page: number | null; pageStart: number | null; pageEnd: number | null; sourceUrl: string | null }
export interface ChatResult { conversationId: string; answer: string; citations: Citation[]; metadata: { courseId: string | null; intent: string; retrievedChunks: number; provider: string } }
export interface StoredMessage { id: string; role: string; content: string; citations: Citation[]; createdAt: string }
export interface Conversation { id: string; title: string | null; courseId: string | null; semester: number | null; createdAt: string; updatedAt: string; messages: StoredMessage[] }
export interface ConversationSummary { id: string; title: string | null; createdAt: string; updatedAt: string }
export interface SourceDetail { id: string; content: string; pageStart: number | null; pageEnd: number | null; document: { title: string; sourceUrl: string | null; type: string; course: { id: string; name: string } } }
export interface UIMessage { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; pending?: boolean }
