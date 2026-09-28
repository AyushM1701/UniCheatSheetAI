import type { QueryIntent } from './types.js';
export function routeQuery(message: string): QueryIntent {
  const text = message.toLowerCase();
  if (!/\b(?:do not|don't|dont|without|no)\s+(?:generate|create|make|write)\b/.test(text) && /\b(generate|create|make|write)\b[\s\S]*\b(practice|quiz|questions?|mcqs?)\b|\b(practice|quiz)\b[\s\S]*\b(questions?|mcqs?)\b/.test(text)) return 'practice_generation';
  if (/\b(how many|count|number of)\b[\s\S]*\b(notes?|files?|documents?|resources?|pyqs?|papers?)\b/.test(text)) return 'database_query';
  if (/\b(pyqs?|previous year|past papers?|question papers?)\b/.test(text)) return 'resource_search';
  if (/^(hi|hello|hey|thanks|thank you)[!.\s]*$/.test(text.trim())) return 'general_chat';
  return 'academic_rag';
}
export function retrievalQuery(message: string, courseId?: string | null, history: Array<{ role: string; content: string }> = []): string {
  const topic = message.match(/\b(?:say|show|tell|ask)\s+about\s+(.+?)[?.!]*$/i)?.[1] ?? message;
  const course = courseId ? courseId.replace(/-/g, '[\\s-]*') : '';
  const withoutSourcePhrase = topic.replace(/\b(?:from|using|in)\s+(?:the\s+)?(?:19|20)\d{2}\b[^?.]{0,100}\b(?:papers?|notes?|material)\b/gi, ' ');
  const withoutCourse = course ? withoutSourcePhrase.replace(new RegExp(`\\b${course}\\b`, 'gi'), ' ') : withoutSourcePhrase;
  const cleaned = withoutCourse.replace(/\b(give me|show me|find|explain|using the notes?|from my notes?|generate|create|practice|questions?|pyqs?|previous year|papers?|about|for my exam|using unicheatsheet|material)\b/gi, ' ').replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim();
  const prior = [...history].reverse().find((item) => item.role === 'user' && item.content.trim());
  if (prior && /\b(it|its|this|that|these|those|them)\b/i.test(message) && message.trim().split(/\s+/).length <= 12) {
    return `${retrievalQuery(prior.content, courseId).slice(0, 220)} ${cleaned}`.trim();
  }
  return cleaned.length >= 2 ? cleaned : message;
}
