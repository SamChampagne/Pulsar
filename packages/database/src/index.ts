/**
 * Single entry point for database access across the monorepo.
 * Apps must depend on @pulsar/database instead of @prisma/client directly,
 * so the generated client stays an implementation detail of this package.
 */
export * from '@prisma/client';
export { Prisma, PrismaClient } from '@prisma/client';
