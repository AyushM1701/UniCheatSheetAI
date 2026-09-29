import type { QueryIntent } from './types.js';
export function routeQuery(message: string): QueryIntent {
  const text = message.toLowerCase();
  if (!/\b(?:do not|don't|dont|without|no)\s+(?:generate|create|make|write)\b/.test(text) && /\b(generate|create|make|write)\b[\s\S]*\b(practice|quiz|questions?|mcqs?)\b|\b(practice|quiz)\b[\s\S]*\b(questions?|mcqs?)\b/.test(text)) return 'practice_generation';
  if (/\b(how many|count|number of)\b[\s\S]*\b(notes?|files?|documents?|resources?|pyqs?|papers?)\b/.test(text)) return 'database_query';
  if (/\b(?:explain|solve|answer|work through|walk through|teach|derive|demonstrate)\b/.test(text) && /\b(pyqs?|previous year|past[-\s]+papers?|question[-\s]+papers?)\b/.test(text)) return 'academic_rag';
  if (/\b(pyqs?|previous year|past[-\s]+papers?|question[-\s]+papers?)\b/.test(text)) return 'resource_search';
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
  const filler = new Set(['a', 'an', 'and', 'based', 'for', 'in', 'me', 'my', 'of', 'on', 'please', 'some', 'the', 'these', 'those', 'to']);
  return cleaned.split(/\s+/).some((word) => word && !filler.has(word.toLowerCase())) ? cleaned : '';
}

/** Remove broad exam-browsing language while retaining a real topic, if one was supplied. */
export function pyqTopicQuery(message: string, courseId?: string | null, history: Array<{ role: string; content: string }> = []): string {
  const neutralized = message.replace(/\b(?:past[-\s]+papers?|question[-\s]+papers?)\b/gi, 'PYQs')
    .replace(/\b(?:from|for|in)\s+(?:this|the)\s+course\b/gi, ' ')
    .replace(/\b(?:real|actual|indexed)\b/gi, ' ');
  const query = retrievalQuery(neutralized, courseId, history);
  return query.replace(/\b(?:this|the)\s+course\b/gi, ' ').replace(/^\s*(?:on|about|regarding)\s+/i, '').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();
}
