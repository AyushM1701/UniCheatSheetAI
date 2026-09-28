import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { runRclone } from '@ucs/drive-sync';
import { writeResourceCatalog, type CourseAlias, type ScannedResource } from '@ucs/unicheatsheet-source';

type Mapping = { courseId: string; semester: number; type?: ScannedResource['type'] };
type Folder = { id: string; default?: Mapping; files?: Record<string, Mapping> };
type Config = { folders: Folder[]; output?: string };
type RcloneEntry = { ID?: string; Name?: string; Path?: string; IsDir?: boolean; MimeType?: string };

const configPath = process.argv[2] ?? 'catalog/drive-folders.json';
const config = JSON.parse(await readFile(configPath, 'utf8')) as Config;
if (!Array.isArray(config.folders) || !config.folders.length) throw new Error('Folder configuration needs a nonempty folders array');
const remote = process.env.DRIVE_REMOTE;
if (!remote || !/^[A-Za-z0-9][A-Za-z0-9_-]*:$/.test(remote)) throw new Error('Set DRIVE_REMOTE to an rclone remote root ending in :');
const binary = process.env.RCLONE_BINARY ?? 'rclone';
const courses = JSON.parse(await readFile('catalog/courses.json', 'utf8')) as CourseAlias[];
const catalog: ScannedResource[] = [];
const seen = new Set<string>();
const skipped: Array<{ folder: string; name: string; reason: string }> = [];
for (const folder of config.folders) {
  if (!/^[A-Za-z0-9_-]{3,}$/.test(folder.id)) throw new Error(`Invalid folder ID: ${folder.id}`);
  const entries = JSON.parse(await runRclone(['lsjson', remote, '--drive-root-folder-id', folder.id, '--recursive'], binary)) as RcloneEntry[];
  if (!Array.isArray(entries)) throw new Error(`rclone returned no file list for ${folder.id}`);
  for (const entry of entries) {
    if (entry.IsDir) continue;
    const name = entry.Name ?? entry.Path ?? '';
    if (!entry.ID || !/^[A-Za-z0-9_-]{3,}$/.test(entry.ID) || !name) { skipped.push({ folder: folder.id, name, reason: 'missing file identity' }); continue; }
    if (!name.toLowerCase().endsWith('.pdf') || (entry.MimeType && entry.MimeType !== 'application/pdf')) { skipped.push({ folder: folder.id, name, reason: 'unsupported file type' }); continue; }
    const mapping = folder.files?.[entry.ID] ?? folder.default;
    if (!mapping) { skipped.push({ folder: folder.id, name, reason: 'course mapping required' }); continue; }
    const course = courses.find((item) => item.id === mapping.courseId && item.semester === mapping.semester);
    if (!course) { skipped.push({ folder: folder.id, name, reason: `unknown course or semester: ${mapping.courseId}` }); continue; }
    const referenceKey = [folder.id, course.id, mapping.type ?? 'pyq', entry.ID, name].join('|');
    if (seen.has(referenceKey)) continue;
    seen.add(referenceKey);
    catalog.push({ semester: mapping.semester, courseId: course.id, courseName: course.name, type: mapping.type ?? 'pyq', title: name.replace(/\.pdf$/i, ''), provider: 'google_drive', driveFileId: entry.ID, sourceUrl: `https://drive.google.com/file/d/${entry.ID}/view`, sourcePage: `drive-folder:${folder.id}` });
  }
}
const output = config.output ?? 'catalog/folder-resources.json';
await writeResourceCatalog(output, catalog);
console.log(JSON.stringify({ output, folders: config.folders.length, indexedCandidates: catalog.length, skipped }, null, 2));
if (skipped.length) process.exitCode = 1;
