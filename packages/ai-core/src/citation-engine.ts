import type { CitedSource, Citation } from './types.js';
export function validateCitations(answer: string, sources: CitedSource[]): { answer: string; citations: Citation[] } {
  const allowed = new Map(sources.map((source) => [source.id, source.citation]));
  const clean = answer.replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_match, group: string) => group.split(/\s*,\s*/).filter((id) => allowed.has(id)).map((id) => `[${id}]`).join(' ')).replace(/https?:\/\/\S+/g, '').trim();
  const ids = [...new Set([...clean.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!))];
  return { answer: clean, citations: ids.map((id) => allowed.get(id)!).filter(Boolean) };
}
