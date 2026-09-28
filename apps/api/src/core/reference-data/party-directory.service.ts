import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { validateDirectoryEntry, type ReferenceKind } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { lockBusinessTenant } from '../../modules/business/business-lock';
import { CreateDirectoryDto, DirectoryQueryDto, UpdateDirectoryDto } from './party-directory.dto';

type Tx = Prisma.TransactionClient;
export type OwnerKind = Extract<ReferenceKind, 'customer' | 'client' | 'supplier'> | 'crm-company';
const publicSelect = {
  id: true,
  kind: true,
  label: true,
  data: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
@Injectable()
export class PartyDirectoryService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}
  private ownerWhere(kind: OwnerKind, id: string) {
    // Keep the legacy object shape: historical replay fingerprints include this object.
    if (kind === 'crm-company') return { companyId: id, customerId: null, partnerId: null };
    return kind === 'customer'
      ? { customerId: id, partnerId: null }
      : { partnerId: id, customerId: null };
  }
  private async parent(tx: Tx, tenantId: string, kind: OwnerKind, id: string) {
    if (kind === 'crm-company') {
      const company = await tx.crmCompany.findFirst({
        where: { tenantId, id },
        select: { id: true },
      });
      if (!company) throw new NotFoundException('Société CRM introuvable.');
      return;
    }
    const row =
      kind === 'customer'
        ? await tx.customer.findFirst({ where: { tenantId, id }, select: { id: true } })
        : await tx.businessPartner.findFirst({
            where: { tenantId, id, [kind === 'client' ? 'isCustomer' : 'isSupplier']: true },
            select: { id: true },
          });
    if (!row) throw new NotFoundException('Fiche de référence introuvable.');
  }
  async list(tenantId: string, kind: OwnerKind, ownerId: string, q: DirectoryQueryDto) {
    await this.parent(this.db, tenantId, kind, ownerId);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.PartyDirectoryEntryWhereInput = {
      tenantId,
      ...this.ownerWhere(kind, ownerId),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.search ? { label: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.partyDirectoryEntry.findMany({
        where,
        select: publicSelect,
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.db.partyDirectoryEntry.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async entry(tenantId: string, kind: OwnerKind, ownerId: string, id: string, tx: Tx = this.db) {
    await this.parent(tx, tenantId, kind, ownerId);
    const row = await tx.partyDirectoryEntry.findFirst({
      where: { tenantId, id, ...this.ownerWhere(kind, ownerId) },
      select: publicSelect,
    });
    if (!row) throw new NotFoundException('Entrée du carnet introuvable.');
    return row;
  }
  async history(
    tenantId: string,
    kind: OwnerKind,
    ownerId: string,
    id: string,
    q: DirectoryQueryDto,
  ) {
    await this.parent(this.db, tenantId, kind, ownerId);
    const row = await this.db.partyDirectoryEntry.findFirst({
      where: { tenantId, id, ...this.ownerWhere(kind, ownerId) },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Entrée du carnet introuvable.');
    const { page, pageSize, skip, take } = paginationArgs(q),
      where = { tenantId, entryId: id };
    const [items, total] = await this.db.$transaction([
      this.db.partyDirectoryRevision.findMany({
        where,
        select: { version: true, snapshot: true, reason: true, createdAt: true },
        orderBy: { version: 'desc' },
        skip,
        take,
      }),
      this.db.partyDirectoryRevision.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  async save(
    tenantId: string,
    actorId: string,
    kind: OwnerKind,
    ownerId: string,
    dto: CreateDirectoryDto | UpdateDirectoryDto,
    id?: string,
  ) {
    const parsed = validateDirectoryEntry(dto.entry);
    if (!parsed.value) throw new BadRequestException(parsed.errors);
    const entry = parsed.value;
    const expected = 'expectedVersion' in dto ? dto.expectedVersion : null;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          owner: this.ownerWhere(kind, ownerId),
          id: id ?? null,
          expected,
          entry,
          reason: dto.reason,
        }),
      )
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      await this.parent(tx, tenantId, kind, ownerId);
      await this.ownership.assertOwned(
        kind === 'customer'
          ? 'customer'
          : kind === 'crm-company'
            ? 'crmCompany'
            : 'businessPartner',
        ownerId,
        tenantId,
        tx,
      );
      const prior = await tx.partyDirectoryRevision.findFirst({
        where: { tenantId, actorId, operationKey: dto.operationKey },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé de reprise appartient à une autre modification.');
        // Replay the original receipt, even if a later version is already current.
        return prior.snapshot;
      }
      const old = id
        ? await tx.partyDirectoryEntry.findFirst({
            where: { tenantId, id, ...this.ownerWhere(kind, ownerId) },
          })
        : null;
      if (id && !old) throw new NotFoundException('Entrée du carnet introuvable.');
      if (old && (old.version !== expected || old.kind !== entry.kind))
        throw new ConflictException(
          'La fiche a changé ou son type diffère. Rechargez le carnet avant de poursuivre.',
        );
      const data = {
        kind: entry.kind,
        label: entry.label,
        data: entry as unknown as Prisma.InputJsonObject,
      };
      const saved = old
        ? await tx.partyDirectoryEntry.update({
            where: { tenantId_id: { tenantId, id: old.id } },
            data: { ...data, version: { increment: 1 } },
            select: publicSelect,
          })
        : await tx.partyDirectoryEntry.create({
            data: { ...data, tenantId, ...this.ownerWhere(kind, ownerId) },
            select: publicSelect,
          });
      const snapshot = JSON.parse(JSON.stringify(saved)) as Prisma.InputJsonObject;
      await tx.partyDirectoryRevision.create({
        data: {
          tenantId,
          entryId: saved.id,
          version: saved.version,
          snapshot,
          actorId,
          reason: dto.reason,
          operationKey: dto.operationKey,
          fingerprint,
        },
      });
      return snapshot;
    });
  }
}
