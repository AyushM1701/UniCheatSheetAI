import { Workspace } from '@/components/ai/Workspace';
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Workspace initialConversationId={id} />; }
