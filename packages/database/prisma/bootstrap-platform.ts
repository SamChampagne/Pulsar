/** Remote dev bootstrap: catalogs + one operator, NEVER demo business data.
 * Existing credentials, status and MFA are intentionally preserved on rerun.
 */
import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { MODULE_CATALOG, PERMISSION_CATALOG } from '@pulsar/shared';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('A valid PLATFORM_ADMIN_EMAIL is required');
  if (
    !password ||
    password.length < 16 ||
    Buffer.byteLength(password, 'utf8') > 72 ||
    password.startsWith('REPLACE_')
  )
    throw new Error('PLATFORM_ADMIN_PASSWORD must be 16–72 bytes and not a placeholder');
  await prisma.$transaction(
    async (tx) => {
      for (const p of PERMISSION_CATALOG)
        await tx.permission.upsert({
          where: { key: p.key },
          update: { module: p.module, description: p.description },
          create: { key: p.key, module: p.module, description: p.description },
        });
      for (const m of MODULE_CATALOG) {
        const data = {
          name: m.name,
          description: m.description,
          isCore: m.isCore,
          available: m.available,
        };
        await tx.moduleDefinition.upsert({
          where: { key: m.key },
          update: data,
          create: { key: m.key, ...data },
        });
      }
      await tx.platformUser.upsert({
        where: { email },
        update: {},
        create: {
          email,
          passwordHash: hashSync(password, 12),
          firstName: 'Platform',
          lastName: 'Admin',
          status: 'ACTIVE',
        },
      });
    },
    { timeout: 30000 },
  );
  console.log('Platform catalogs ready; operator created or preserved. No demo tenant seeded.');
}
main()
  .catch(() => {
    console.error(
      'Platform bootstrap failed. Check required credentials and database connectivity; no secrets logged.',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
