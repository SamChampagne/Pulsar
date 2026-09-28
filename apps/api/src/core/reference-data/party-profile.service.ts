import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { type PartyKind, validatePartyProfile } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { lockBusinessTenant } from '../../modules/business/business-lock';

export const partyWhere = (kind: PartyKind, id: string) => ({
  customerId: kind === 'customer' ? id : null,
  companyId: kind === 'crm-company' ? id : null,
  partnerId: ['partner', 'client', 'supplier'].includes(kind) ? id : null,
});
export async function partyParent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kind: PartyKind,
  id: string,
) {
  const select = { id: true, name: true, updatedAt: true } as const;
  const row =
    kind === 'customer'
      ? await tx.customer.findFirst({ where: { tenantId, id }, select })
      : kind === 'crm-company'
        ? await tx.crmCompany.findFirst({ where: { tenantId, id }, select })
        : await tx.businessPartner.findFirst({
            where: {
              tenantId,
              id,
              ...(kind === 'client'
                ? { isCustomer: true }
                : kind === 'supplier'
                  ? { isSupplier: true }
                  : {}),
            },
            select,
          });
  if (!row) throw new NotFoundException('Fiche introuvable.');
  return row;
}
const select = { id: true, data: true, version: true, updatedAt: true } as const;
@Injectable()
export class PartyProfileService {
  constructor(private readonly db: PrismaService) {}
  async get(tenantId: string, kind: PartyKind, id: string) {
    await partyParent(this.db, tenantId, kind, id);
    return (
      (await this.db.partyBusinessProfile.findFirst({
        where: { tenantId, ...partyWhere(kind, id) },
        select,
      })) ?? { data: {}, version: 0, updatedAt: null }
    );
  }
  async save(
    tenantId: string,
    kind: PartyKind,
    id: string,
    expectedVersion: number,
    data: unknown,
  ) {
    const parsed = validatePartyProfile(data);
    if (!parsed.value) throw new BadRequestException(parsed.errors);
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      await partyParent(tx, tenantId, kind, id);
      const where = { tenantId, ...partyWhere(kind, id) };
      const old = await tx.partyBusinessProfile.findFirst({ where });
      if ((old?.version ?? 0) !== expectedVersion)
        throw new ConflictException('Cette fiche a changé. Rechargez-la avant de poursuivre.');
      if (old) {
        await tx.partyBusinessProfile.updateMany({
          where: { ...where, version: expectedVersion },
          data: { data: parsed.value as Prisma.InputJsonValue, version: { increment: 1 } },
        });
      } else
        await tx.partyBusinessProfile.create({
          data: { ...where, data: parsed.value as Prisma.InputJsonValue },
        });
      return tx.partyBusinessProfile.findFirstOrThrow({ where, select });
    });
  }
}
