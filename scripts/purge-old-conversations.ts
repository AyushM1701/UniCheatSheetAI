import 'dotenv/config';
import { db } from '@ucs/database';

const retentionDays = Number(process.env.CONVERSATION_RETENTION_DAYS ?? 90);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('CONVERSATION_RETENTION_DAYS must be an integer from 1 to 3650');
const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
try {
  const result = await db.conversation.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  console.log(JSON.stringify({ deleted: result.count, cutoff: cutoff.toISOString() }));
} finally { await db.$disconnect(); }
