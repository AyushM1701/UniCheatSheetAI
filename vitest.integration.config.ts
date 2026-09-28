import { defineConfig } from 'vitest/config';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/[_-](?:test|review)(?:[_-]|$)/i.test(new URL(databaseUrl).pathname)) {
  throw new Error('Integration tests require DATABASE_URL with a database name containing _test or _review.');
}

export default defineConfig({ test: { include: ['tests/*.integration.test.ts'] } });
