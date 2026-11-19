import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__nourishPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.__nourishPrisma = prisma;

export async function withTransaction(fn) {
  return prisma.$transaction(fn, { maxWait: 10000, timeout: 20000 });
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
