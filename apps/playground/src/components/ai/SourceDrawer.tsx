'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileText, X } from 'lucide-react';
import { ai } from '@/lib/api/ai-client';
import type { Citation, SourceDetail } from '@/types/chat';
export function SourceDrawer({ citation, onClose }: { citation: Citation | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!citation) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true); setDetail(null); setFailed(false);
    ai.getSource(citation.chunkId).then((value) => { if (!cancelled) setDetail(value); }).catch(() => { if (!cancelled) setFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [citation]);
  useEffect(() => {
    if (!citation) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      requestAnimationFrame(() => {
        const fallback = [...document.querySelectorAll<HTMLElement>('[data-source-chunk-id]')].find((item) => item.dataset.sourceChunkId === citation.chunkId);
        if (previous?.isConnected && previous.dataset.sourceChunkId === citation.chunkId) previous.focus();
        else fallback?.focus();
      });
    };
  }, [citation, onClose]);
  if (!citation) return null;
  const page = citation.pageStart ?? citation.page;
  return <><button className="drawer-scrim" tabIndex={-1} aria-label="Close source" onClick={onClose} /><aside ref={dialog} className="source-drawer" role="dialog" aria-modal="true" aria-label="Source details">
    <div className="drawer-top"><span>Source details</span><button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close source"><X size={19} /></button></div>
    <div className="drawer-content"><div className="drawer-file-icon"><FileText size={23} strokeWidth={1.4} /></div><div className="drawer-overline">{detail?.document.course.name ?? 'UNI CHEATSHEET SOURCE'}</div><h2>{citation.documentTitle}</h2><p className="drawer-page">{page ? `Page ${page}` : 'Page not recorded'} <span>·</span> {citation.id}</p>
      <div className="drawer-divider" /><h3>Relevant passage</h3>{(loading || (!detail && !failed)) ? <div className="passage-loading">Loading the cited passage…</div> : <><blockquote>{detail?.content ?? citation.excerpt ?? 'This source passage is no longer available.'}</blockquote>{failed && citation.excerpt && <p className="no-original">Saved excerpt from when this answer was generated. The indexed source has since changed or is unavailable.</p>}</>}
      {detail?.document.sourceUrl ? <a className="original-link" href={detail.document.sourceUrl} target="_blank" rel="noopener noreferrer">Open original <ArrowUpRight size={17} /></a> : !loading && <p className="no-original">No original link is available for this source.</p>}
    </div>
  </aside></>;
}
