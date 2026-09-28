import type { Metadata } from 'next';
import { ChatProvider } from '@/hooks/useChatWorkspace';
import './globals.css';
import 'katex/dist/katex.min.css';
export const metadata: Metadata = { title: 'UniCheatSheet AI', description: 'Ask your academic material.', icons: { icon: '/logo.webp' } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><ChatProvider>{children}</ChatProvider></body></html>;
}
