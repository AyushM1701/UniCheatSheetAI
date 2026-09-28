import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ScannedResource } from './types.js';

const resourceSchema = z.object({
  semester: z.number().int().positive(),
  courseId: z.string().min(1).optional(),
  courseName: z.string().min(1).optional(),
  type: z.enum(['lecture', 'pyq', 'solution', 'assignment', 'tutorial', 'other']),
  title: z.string().min(1),
  provider: z.literal('google_drive'),
  driveFileId: z.string().regex(/^[A-Za-z0-9_-]{3,}$/),
  sourceUrl: z.string().url(),
  sourcePage: z.string().min(1),
  sectionId: z.string().optional(),
  surroundingHeading: z.string().optional()
}).strict();

export function validateResources(resources: ScannedResource[]): ScannedResource[] {
  return z.array(resourceSchema).parse(resources);
}

export async function writeResourceCatalog(path: string, resources: ScannedResource[]): Promise<void> {
  const checked = validateResources(resources);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}
