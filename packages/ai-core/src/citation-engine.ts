import type { CitedSource, Citation } from './types.js';
export function validateCitations(answer: string, sources: CitedSource[]): { answer: string; citations: Citation[] } {
  if (sources.length && sources.every((source) => source.hit.type === 'pyq')) {
    const marker = /(?:^|\n)#{0,4}\s*General subject explanation\b/i.exec(answer);
    if (marker && marker.index !== undefined) {
      const generalStart = marker.index;
      answer = answer.slice(0, generalStart) + answer.slice(generalStart).replace(/\[S\d+(?:\s*,\s*S\d+)*\]/g, '').replace(/\s+([.,;:])/g, '$1');
    }
  }
  const allowed = new Map(sources.map((source) => [source.id, source.citation]));
  const clean = answer.replace(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_match, group: string) => group.split(/\s*,\s*/).filter((id) => allowed.has(id)).map((id) => `[${id}]`).join(' ')).replace(/https?:\/\/\S+/g, '').trim();
  const ids = [...new Set([...clean.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!))];
  return { answer: clean, citations: ids.map((id) => allowed.get(id)!).filter(Boolean) };
}
