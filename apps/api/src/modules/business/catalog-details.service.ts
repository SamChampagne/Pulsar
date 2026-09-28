import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { validateCatalogDetails, type SupplierTermsSnapshot } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { paginated, paginationArgs } from '../../common/pagination';
import { lockBusinessTenant } from './business-lock';
import { SaveSupplierOfferDto, SupplierOffersQueryDto } from './catalog-details.dto';

type Tx = Prisma.TransactionClient;
const itemSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unit: true,
  active: true,
} as const;
const offerInclude = {
  supplier: { select: { id: true, code: true, name: true, active: true, isSupplier: true } },
  catalogItem: { select: itemSelect },
} as const;
async function item(tx: Tx, tenantId: string, id: string) {
  const row = await tx.catalogItem.findFirst({ where: { tenantId, id }, select: itemSelect });
  if (!row) throw new NotFoundException('Article introuvable.');
  return row;
}
@Injectable()
export class CatalogDetailsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}
  async get(tenantId: string, id: string) {
    const catalogItem = await item(this.db, tenantId, id);
    const row = await this.db.catalogItemDetails.findFirst({
      where: { tenantId, catalogItemId: id },
    });
    return { item: catalogItem, version: row?.version ?? 0, data: row?.data ?? {} };
  }
  save(tenantId: string, id: string, expectedVersion: number, data: unknown) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      const catalogItem = await item(tx, tenantId, id);
      const parsed = validateCatalogDetails(data, catalogItem.kind);
      if (!parsed.value) throw new BadRequestException(parsed.errors);
      const old = await tx.catalogItemDetails.findFirst({ where: { tenantId, catalogItemId: id } });
      if ((old?.version ?? 0) !== expectedVersion)
        throw new ConflictException('La fiche article a changé. Rechargez-la.');
      const value = parsed.value as Prisma.InputJsonObject;
      if (old)
        await tx.catalogItemDetails.updateMany({
          where: { tenantId, catalogItemId: id, version: expectedVersion },
          data: { data: value, version: expectedVersion + 1 },
        });
      else
        await tx.catalogItemDetails.create({ data: { tenantId, catalogItemId: id, data: value } });
      return { item: catalogItem, version: expectedVersion + 1, data: value };
    });
  }
  async offers(tenantId: string, id: string, q: SupplierOffersQueryDto) {
    await item(this.db, tenantId, id);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.CatalogSupplierOfferWhereInput = {
      tenantId,
      catalogItemId: id,
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.search
        ? {
            OR: [
              { supplierReference: { contains: q.search, mode: 'insensitive' } },
              { supplier: { name: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.catalogSupplierOffer.findMany({
        where,
        include: offerInclude,
        orderBy: [{ supplierReference: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.db.catalogSupplierOffer.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }
  saveOffer(tenantId: string, id: string, dto: SaveSupplierOfferDto) {
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      await item(tx, tenantId, id);
      await this.ownership.assertOwned('businessPartner', dto.supplierId, tenantId, tx);
      const supplier = await tx.businessPartner.findFirst({
        where: { tenantId, id: dto.supplierId, isSupplier: true },
      });
      if (!supplier || (dto.active && !supplier.active))
        throw new BadRequestException('Choisissez un fournisseur actif.');
      const old = await tx.catalogSupplierOffer.findFirst({
        where: { tenantId, catalogItemId: id, supplierId: dto.supplierId },
      });
      if ((old?.version ?? 0) !== dto.expectedVersion)
        throw new ConflictException(
          'Cette référence fournisseur a changé ou existe déjà. Rechargez la liste.',
        );
      for (const key of ['minimumQuantity', 'orderMultiple'] as const)
        if (dto[key] != null && new Prisma.Decimal(dto[key]).lte(0))
          throw new BadRequestException('Minimum et multiple doivent être strictement positifs.');
      if (dto.validFrom && dto.validUntil && dto.validFrom > dto.validUntil)
        throw new BadRequestException('La fin de validité précède le début.');
      const { expectedVersion, ...fields } = dto;
      const data = {
        ...fields,
        minimumQuantity: dto.minimumQuantity ?? null,
        orderMultiple: dto.orderMultiple ?? null,
        leadTimeDays: dto.leadTimeDays ?? null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        version: expectedVersion + 1,
      };
      if (old) {
        await tx.catalogSupplierOffer.updateMany({
          where: { tenantId, id: old.id, version: expectedVersion },
          data,
        });
        return tx.catalogSupplierOffer.findFirstOrThrow({
          where: { tenantId, id: old.id },
          include: offerInclude,
        });
      }
      return tx.catalogSupplierOffer.create({
        data: { ...data, tenantId, catalogItemId: id },
        include: offerInclude,
      });
    });
  }
}

/** Called only inside the shared business lock. Never guesses an offer or converts units. */
export async function captureSupplierTerms(
  tx: Tx,
  tenantId: string,
  input: {
    offerId: string;
    version: number;
    supplierId: string;
    catalogItemId: string;
    currency: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
  },
  now = new Date(),
): Promise<SupplierTermsSnapshot> {
  const offer = await tx.catalogSupplierOffer.findFirst({
    where: {
      tenantId,
      id: input.offerId,
      supplierId: input.supplierId,
      catalogItemId: input.catalogItemId,
    },
    include: offerInclude,
  });
  if (!offer)
    throw new BadRequestException(
      'Référence fournisseur incompatible avec cet article ou fournisseur.',
    );
  if (offer.version !== input.version)
    throw new ConflictException(
      'Conditions fournisseur modifiées. Sélectionnez leur nouvelle version et enregistrez le brouillon.',
    );
  if (
    !offer.active ||
    !offer.supplier.active ||
    !offer.supplier.isSupplier ||
    !offer.catalogItem.active
  )
    throw new ConflictException('Référence fournisseur ou article inactif.');
  const day = now.toISOString().slice(0, 10);
  if (
    (offer.validFrom && day < offer.validFrom.toISOString().slice(0, 10)) ||
    (offer.validUntil && day > offer.validUntil.toISOString().slice(0, 10))
  )
    throw new ConflictException('Conditions fournisseur hors validité à la date UTC courante.');
  if (offer.currency !== input.currency || !offer.unitPrice.eq(input.unitPrice))
    throw new ConflictException(
      'Devise ou prix différent des conditions choisies. Resélectionnez la référence ou passez explicitement en prix manuel.',
    );
  if (offer.minimumQuantity && input.quantity.lt(offer.minimumQuantity))
    throw new BadRequestException(
      `Quantité minimale : ${offer.minimumQuantity} ${offer.catalogItem.unit}.`,
    );
  if (offer.orderMultiple && !input.quantity.mod(offer.orderMultiple).isZero())
    throw new BadRequestException(
      `Commandez un multiple de ${offer.orderMultiple} ${offer.catalogItem.unit}. Aucun arrondi automatique.`,
    );
  return {
    schemaVersion: 1,
    offerId: offer.id,
    version: offer.version,
    supplierId: offer.supplierId,
    catalogItemId: offer.catalogItemId,
    supplierReference: offer.supplierReference,
    unit: offer.catalogItem.unit,
    currency: offer.currency,
    unitPrice: offer.unitPrice.toString(),
    minimumQuantity: offer.minimumQuantity?.toString() ?? null,
    orderMultiple: offer.orderMultiple?.toString() ?? null,
    leadTimeDays: offer.leadTimeDays,
    validFrom: offer.validFrom?.toISOString().slice(0, 10) ?? null,
    validUntil: offer.validUntil?.toISOString().slice(0, 10) ?? null,
    packaging: offer.packaging,
    terms: offer.terms,
    capturedAt: now.toISOString(),
  };
}
