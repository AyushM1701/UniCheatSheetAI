'use client';
import { ArrowUpRight, FileText } from 'lucide-react';
import type { Citation } from '@/types/chat';
export function SourceCard({ citation, onClick }: { citation: Citation; onClick: () => void }) {
  const page = citation.pageStart ?? citation.page;
  return <button className="source-card" data-source-chunk-id={citation.chunkId} onClick={onClick}><span className="source-card-icon"><FileText size={16} strokeWidth={1.7} /></span><span className="source-card-copy"><strong>{citation.documentTitle}</strong><small>{citation.courseId ? `${citation.courseId} · ` : ''}{page ? `Page ${page}` : 'Source document'} · {citation.id}</small></span><ArrowUpRight className="source-card-arrow" size={15} strokeWidth={1.7} /></button>;
}
