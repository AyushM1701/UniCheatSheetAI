import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { db } from '@ucs/database';

const courses = JSON.parse(await readFile(new URL('../catalog/courses.json', import.meta.url), 'utf8')) as Array<{ id: string; code: string; name: string; semester: number; aliases: string[]; description: string }>;
for (const course of courses) await db.course.upsert({ where: { id: course.id }, create: course, update: course });
await db.$disconnect();
console.log(`Seeded ${courses.length} course(s)`);
