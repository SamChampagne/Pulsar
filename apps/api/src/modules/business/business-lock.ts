import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { OwnershipService } from '../../prisma/ownership.service';

export async function lockBusinessTenant(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business:${tenantId}`}, 0))`;
}
export function nextBusinessVersion(row: { updatedAt: Date }, expected: string) {
  if (row.updatedAt.getTime() !== new Date(expected).getTime())
    throw new ConflictException('Ce dossier a changé. Rechargez-le avant de poursuivre.');
  return new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
}
export const servicePersonSelect = {
  id: true,
  firstName: true,
  lastName: true,
  status: true,
} as const;
export async function assertServicePerson(
  tx: Prisma.TransactionClient,
  ownership: OwnershipService,
  tenantId: string,
  id: string,
) {
  await ownership.assertOwned('user', id, tenantId, tx);
  // Synchronizes with normal User updates too (which do not take the business lock).
  await tx.$queryRaw`SELECT id FROM users WHERE "tenantId" = ${tenantId} AND id = ${id} FOR SHARE`;
  const person = await tx.user.findFirst({
    where: {
      tenantId,
      id,
      status: 'ACTIVE',
      agentServiceFor: { none: {} },
      NOT: { email: 'service-account@pulsar.local' },
    },
    select: servicePersonSelect,
  });
  if (!person)
    throw new BadRequestException('Choisissez un utilisateur interne actif de cette entreprise.');
  return person;
}
