'use client';
import { Search, Sparkles } from 'lucide-react';
import type { ChatStatus } from '@/types/chat';
export function ThinkingState({ status, sourceCount }: { status: ChatStatus; sourceCount: number }) {
  if (status !== 'retrieving' && status !== 'generating') return null;
  return <div className="thinking-state" role="status" aria-live="polite"><span className="thinking-icon">{status === 'retrieving' ? <Search size={15} /> : <Sparkles size={15} />}</span><span>{status === 'retrieving' ? 'Searching UniCheatSheet' : sourceCount ? `Found ${sourceCount} source${sourceCount === 1 ? '' : 's'} · Preparing answer` : 'Preparing answer'}</span><span className="thinking-dots"><i /><i /><i /></span></div>;
}
