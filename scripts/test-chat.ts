import { config } from 'dotenv';
import { db } from '@ucs/database';
import { chatService } from '@ucs/ai-core';
config();
const message = process.argv[2] ?? 'Explain sustainable water management using UniCheatSheet EVS Living Lab material.';
const courseId = process.argv[3] ?? 'evs-living-lab';
try {
  const result = await chatService.chat({ message, scope: { courseId } }, [courseId], 'dev-local');
  console.log(JSON.stringify(result, null, 2));
} finally { await db.$disconnect(); }
