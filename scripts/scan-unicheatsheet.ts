import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeResources, scanUniCheatSheet, writeResourceCatalog, type CourseAlias } from '@ucs/unicheatsheet-source';

const sourceRoot = process.argv[2] ?? process.env.UNICHEATSHEET_SOURCE_DIR ?? process.env.UCS_SITE_ROOT;
if (!sourceRoot) throw new Error('Set UNICHEATSHEET_SOURCE_DIR or pass the website source directory as an argument');
const courses = JSON.parse(await readFile('catalog/courses.json', 'utf8')) as CourseAlias[];
const report = await scanUniCheatSheet(resolve(sourceRoot));
const normalized = normalizeResources(report.resources, courses);
await writeResourceCatalog('catalog/resources.raw.json', report.resources);
await writeResourceCatalog('catalog/resources.json', normalized.resources);
const byType = Object.fromEntries(['lecture', 'pyq', 'solution'].map((type) => [type, report.resources.filter((resource) => resource.type === type).length]));
console.log(JSON.stringify({ sourceRoot: resolve(sourceRoot), semesterPages: report.filesScanned, driveLinks: report.driveLinks, uniqueResources: report.resources.length, duplicateIds: report.duplicateIds, resolvedCourses: normalized.resolved.length, unresolvedCourses: normalized.unresolved.length, byType, rawCatalog: 'catalog/resources.raw.json', catalog: 'catalog/resources.json' }, null, 2));
if (!report.resources.length) console.log('No Drive file links found. The scanned website may still contain placeholder href="#" cards; both catalogs were written as empty arrays.');
