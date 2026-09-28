import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { normalizeScan, packageQuantity, type CatalogPackageSnapshot } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { lockBusinessTenant } from './business-lock';
import { CreateCatalogPackageDto, UpdateCatalogPackageDto } from './catalog-packaging.dto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginationArgs, paginated } from '../../common/pagination';
import { supplierReceiptLines, receiptProgress } from './supplier-receipts.service';
type Tx = Prisma.TransactionClient;
async function product(tx: Tx, tenantId: string, id: string) {
  const row = await tx.catalogItem.findFirst({ where: { tenantId, id } });
  if (!row) throw new NotFoundException('Article introuvable.');
  if (row.kind !== 'GOODS')
    throw new BadRequestException(
      'Les conditionnements sont réservés aux produits, pas aux prestations.',
    );
  return row;
}
export function convertPackage(
  count: string,
  factor: string,
  wholeOnly: boolean,
  precision: 3 | 4 = 4,
) {
  try {
    return packageQuantity(count, factor, wholeOnly, precision);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}
@Injectable()
export class CatalogPackagingService {
  constructor(private readonly db: PrismaService) {}
  private async locked<T>(tenantId: string, work: (tx: Tx) => Promise<T>) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        return work(tx);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException(
          'Ce code article/conditionnement ou code-barres existe déjà dans votre entreprise, même désactivé.',
        );
      throw e;
    }
  }
  async list(tenantId: string, id: string, q: ListQueryDto) {
    const item = await product(this.db, tenantId, id);
    const { page, pageSize, skip, take } = paginationArgs(q);
    const where: Prisma.CatalogPackageWhereInput = {
      tenantId,
      catalogItemId: id,
      ...(q.search
        ? {
            OR: [
              { label: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
              { barcode: { equals: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.catalogPackage.findMany({
        where,
        skip,
        take,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
      this.db.catalogPackage.count({ where }),
    ]);
    return { ...paginated(items, total, page, pageSize), baseUnit: item.unit };
  }
  create(tenantId: string, id: string, d: CreateCatalogPackageDto) {
    return this.locked(tenantId, async (tx) => {
      const item = await product(tx, tenantId, id);
      if (!item.active)
        throw new ConflictException('Réactivez l’article avant d’ajouter un conditionnement.');
      // Validate the factor independently; conversion precision is checked on actual counts.
      const factor = new Prisma.Decimal(d.unitsPerPackage);
      if (factor.lte(0) || factor.gt(1_000_000_000))
        throw new BadRequestException('Contenu positif, maximum 1 milliard.');
      let barcode: string | null = null;
      if (d.barcode) {
        try {
          barcode = normalizeScan(d.barcode);
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
      }
      return tx.catalogPackage.create({
        data: {
          tenantId,
          catalogItemId: id,
          code: d.code,
          label: d.label,
          unitsPerPackage: factor,
          wholeOnly: d.wholeOnly,
          barcode,
        },
      });
    });
  }
  update(tenantId: string, id: string, packageId: string, d: UpdateCatalogPackageDto) {
    return this.locked(tenantId, async (tx) => {
      await product(tx, tenantId, id);
      const old = await tx.catalogPackage.findFirst({
        where: { tenantId, id: packageId, catalogItemId: id },
      });
      if (!old) throw new NotFoundException('Conditionnement introuvable.');
      if (old.version !== d.expectedVersion)
        throw new ConflictException('Conditionnement modifié. Rechargez la liste.');
      await tx.catalogPackage.updateMany({
        where: { tenantId, id: packageId, version: old.version },
        data: { label: d.label, active: d.active, version: old.version + 1 },
      });
      return tx.catalogPackage.findFirstOrThrow({ where: { tenantId, id: packageId } });
    });
  }
  async resolve(tenantId: string, orderId: string, raw: string) {
    let code: string;
    try {
      code = normalizeScan(raw);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const order = await this.db.supplierOrder.findFirst({
      where: { tenantId, id: orderId },
      include: { lines: { include: supplierReceiptLines } },
    });
    if (!order) throw new NotFoundException('Commande introuvable.');
    if (order.status !== 'CONFIRMED')
      throw new ConflictException('Scannez sur une commande confirmée et ouverte.');
    const matches = order.lines.filter(
      (line) =>
        line.packageSnapshot &&
        (line.packageSnapshot as unknown as CatalogPackageSnapshot).barcode === code &&
        new Prisma.Decimal(receiptProgress(line).remaining).gt(0),
    );
    if (!matches.length)
      throw new NotFoundException(
        'Aucun conditionnement capturé avec ce code et un reliquat sur cette commande.',
      );
    if (matches.length !== 1)
      throw new ConflictException(
        'Ce code correspond à plusieurs lignes. Choisissez la ligne manuellement; aucune quantité ajoutée.',
      );
    return {
      orderLineId: matches[0].id,
      orderUpdatedAt: order.updatedAt,
      packageSnapshot: matches[0].packageSnapshot,
    };
  }
}
/** Must run under the shared business tenant lock; used at draft save AND confirmation. */
export async function capturePackage(
  tx: Tx,
  tenantId: string,
  itemId: string,
  packageId: string,
  version: number,
  count: string,
  expectedQuantity: Prisma.Decimal,
): Promise<CatalogPackageSnapshot> {
  const item = await product(tx, tenantId, itemId);
  const row = await tx.catalogPackage.findFirst({
    where: { tenantId, id: packageId, catalogItemId: itemId },
  });
  if (!row) throw new BadRequestException('Conditionnement incompatible avec cet article.');
  if (!row.active || !item.active)
    throw new ConflictException('Article ou conditionnement inactif.');
  if (row.version !== version)
    throw new ConflictException(
      'Conditionnement modifié. Resélectionnez sa version avant de confirmer.',
    );
  const baseQuantity = convertPackage(count, row.unitsPerPackage.toString(), row.wholeOnly);
  if (!new Prisma.Decimal(baseQuantity).eq(expectedQuantity))
    throw new BadRequestException(
      'La quantité de base ne correspond pas au nombre de conditionnements.',
    );
  return {
    schemaVersion: 1,
    packageId: row.id,
    version: row.version,
    catalogItemId: itemId,
    code: row.code,
    label: row.label,
    barcode: row.barcode,
    baseUnit: item.unit,
    unitsPerPackage: row.unitsPerPackage.toString(),
    wholeOnly: row.wholeOnly,
    orderedCount: new Prisma.Decimal(count).toString(),
    baseQuantity,
  };
}
