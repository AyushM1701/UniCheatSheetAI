import { PrismaClient } from './generated/index.js';
export { Prisma } from './generated/index.js';

export const db = new PrismaClient();
