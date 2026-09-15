import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MrpEntry } from '@pulsar/database';
import {
  AuditAction,
  convertMrpCommercialQuantity,
  deriveDemandCoverage,
  type PlanningDemand,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { MrpSalesDemandDto, MrpProductMappingDto, MrpMappingsQuery } from './mrp.dto';

const day = (value: Date) => value.toISOString().slice(0, 10);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const mrpSourceInclude = {
  salesOrder: { select: { id: true, tenantId: true, number: true, status: true, updatedAt: true } },
} as const;

@Injectable()
export class MrpDemandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}

  async requireCrm(tenantId: string, permissions: readonly string[]) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('crm') || !permissions.includes('crm.read'))
      throw new ForbiddenException(
        'Ce périmètre contient des demandes CRM : CRM activé et crm.read sont requis.',
      );
  }

  async sources(
    tenantId: string,
    permissions: readonly string[],
    query: ListQueryDto,
    salesOrderId?: string,
  ) {
    await this.requireCrm(tenantId, permissions);
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('wms') || !enabled.has('manufacturing'))
      throw new ForbiddenException('Fabrication et WMS requis.');
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.SalesOrderLineItemWhereInput = {
      tenantId,
      ...(salesOrderId ? { salesOrderId } : {}),
      salesOrder: { tenantId, status: 'CONFIRMED' },
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { salesOrder: { tenantId, number: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesOrderLineItem.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          quantity: true,
          productId: true,
          updatedAt: true,
          salesOrder: { select: { id: true, number: true, status: true, updatedAt: true } },
          mrpDemands: {
            where: { tenantId },
            select: { id: true, locationId: true, itemId: true, isActive: true },
          },
        },
      }),
      this.prisma.salesOrderLineItem.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async mappings(tenantId: string, permissions: readonly string[], query: MrpMappingsQuery) {
    await this.requireCrm(tenantId, permissions);
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.MrpProductMappingWhereInput = {
      tenantId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.search
        ? { product: { tenantId, name: { contains: query.search, mode: 'insensitive' } } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mrpProductMapping.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'asc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          item: { select: { id: true, sku: true, name: true, unit: true } },
        },
      }),
      this.prisma.mrpProductMapping.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async saveMapping(
    tenantId: string,
    userId: string,
    permissions: readonly string[],
    dto: MrpProductMappingDto,
  ) {
    await this.requireCrm(tenantId, permissions);
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
    await this.ownership.assertOwned('crmProduct', dto.productId, tenantId);
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    const numerator = new Prisma.Decimal(dto.numerator),
      denominator = new Prisma.Decimal(dto.denominator);
    if (
      [numerator, denominator].some(
        (value) => !value.isFinite() || value.lte(0) || value.gt(1e9) || value.decimalPlaces() > 6,
      ) ||
      !dto.commercialUnit.trim()
    )
      throw new BadRequestException('Unité et ratio positifs requis, maximum 6 décimales.');
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const current = await tx.mrpProductMapping.findUnique({
        where: { tenantId_productId: { tenantId, productId: dto.productId } },
      });
      if (
        current
          ? current.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt ?? '').getTime()
          : Boolean(dto.expectedUpdatedAt)
      )
        throw new ConflictException('Correspondance modifiée. Rechargez.');
      const item = await tx.wmsItem.findFirst({
        where: { id: dto.itemId, tenantId, isActive: true },
      });
      const product = await tx.crmProduct.findFirst({
        where: { id: dto.productId, tenantId, active: true },
      });
      if (!item?.unit.trim() || !product)
        throw new BadRequestException('Produit CRM et article WMS actifs requis.');
      const data = {
        itemId: dto.itemId,
        commercialUnit: dto.commercialUnit.trim(),
        numerator,
        denominator,
        isActive: dto.isActive,
        unitSnapshot: item.unit,
        updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1)),
      };
      return tx.mrpProductMapping.upsert({
        where: { tenantId_productId: { tenantId, productId: dto.productId } },
        create: { tenantId, productId: dto.productId, ...data },
        update: data,
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'mrp-product-mapping',
      entityId: saved.id,
      after: json(saved),
    });
    return saved;
  }

  async validateForecast(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationId: string,
    itemId: string,
    dueDate: string,
    forecastId?: string | null,
  ) {
    if (!forecastId) return;
    const forecast = await tx.mrpEntry.findFirst({
      where: { id: forecastId, tenantId, locationId, itemId, kind: 'FORECAST', isActive: true },
    });
    if (
      !forecast?.forecastStart ||
      dueDate < day(forecast.forecastStart) ||
      dueDate > day(forecast.dueDate)
    )
      throw new BadRequestException(
        'Prévision incompatible : même article/site et date comprise dans sa période active requis.',
      );
  }

  async save(
    tenantId: string,
    userId: string,
    permissions: readonly string[],
    dto: MrpSalesDemandDto,
    id?: string,
  ) {
    await this.requireCrm(tenantId, permissions);
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwned('salesOrderLineItem', dto.sourceSalesOrderLineId, tenantId);
    await this.ownership.assertOwnedIfSet('mrpEntry', dto.forecastId, tenantId);
    await this.ownership.assertOwnedIfSet('mrpProductMapping', dto.mappingId, tenantId);
    const saved = await this.prisma.$transaction(async (tx) => {
      // Same lock as CRM confirmation/line writers and WMS/MRP writers.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const current = id
        ? await tx.mrpEntry.findFirst({ where: { id, tenantId } })
        : await tx.mrpEntry.findFirst({
            where: { tenantId, sourceSalesOrderLineId: dto.sourceSalesOrderLineId },
          });
      if (id && !current) throw new NotFoundException('Demande introuvable.');
      if (
        current &&
        (current.sourceSalesOrderLineId !== dto.sourceSalesOrderLineId ||
          current.locationId !== dto.locationId ||
          current.itemId !== dto.itemId)
      )
        throw new ConflictException(
          'Cette ligne CRM est déjà rattachée; site, article et source sont immuables.',
        );
      if (id && current && dto.mappingId) {
        const captured = current.sourceSnapshot as { mapping?: { id?: string } } | null;
        if (captured?.mapping?.id !== dto.mappingId)
          throw new ConflictException(
            'La convention d’unité d’une demande existante est immuable.',
          );
      }
      if (!id && current) {
        const captured = current.sourceSnapshot as { mapping?: { id?: string } } | null;
        if ((captured?.mapping?.id ?? null) !== (dto.mappingId ?? null))
          throw new ConflictException(
            'Le rattachement existant utilise une autre convention d’unité.',
          );
        if (
          day(current.dueDate) === dto.dueDate &&
          current.forecastId === (dto.forecastId ?? null) &&
          current.isActive === dto.isActive
        )
          return { entry: current, replay: true };
        throw new ConflictException(
          'Ligne déjà rattachée. Ouvrez la demande existante pour la modifier.',
        );
      }
      if (
        current &&
        current.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt ?? '').getTime()
      )
        throw new ConflictException('Demande modifiée. Rechargez.');
      const line = await tx.salesOrderLineItem.findFirst({
        where: { id: dto.sourceSalesOrderLineId, tenantId },
        include: mrpSourceInclude,
      });
      if (!line || line.salesOrder.tenantId !== tenantId)
        throw new BadRequestException('Ligne CRM indisponible.');
      if (
        line.updatedAt.getTime() !== new Date(dto.expectedSourceUpdatedAt).getTime() ||
        line.salesOrder.updatedAt.getTime() !== new Date(dto.expectedOrderUpdatedAt).getTime()
      )
        throw new ConflictException(
          'La commande CRM a changé. Rechargez sa source avant de confirmer.',
        );
      if (!current && line.salesOrder.status !== 'CONFIRMED')
        throw new BadRequestException('Seule une commande confirmée peut créer une demande MRP.');
      if (current && dto.isActive) {
        const snapshot = current.sourceSnapshot as {
          salesOrderId?: string;
          productId?: string | null;
          quantity?: string;
        } | null;
        if (
          !snapshot ||
          snapshot.salesOrderId !== line.salesOrderId ||
          snapshot.productId !== line.productId ||
          !line.quantity.equals(snapshot.quantity ?? current.quantity) ||
          line.salesOrder.status === 'DRAFT'
        )
          throw new ConflictException(
            'La définition CRM ne correspond plus au rattachement. Désactivez la demande et vérifiez sa source.',
          );
      }
      if (
        !line.quantity.isFinite() ||
        line.quantity.lte(0) ||
        line.quantity.gt(1e9) ||
        line.quantity.decimalPlaces() > 3
      )
        throw new BadRequestException(
          'Quantité CRM non représentable : valeur positive, maximum 1 milliard et 3 décimales.',
        );
      const item = await tx.wmsItem.findFirst({
        where: { id: dto.itemId, tenantId, isActive: true },
      });
      const site = await tx.location.findFirst({
        where: { id: dto.locationId, tenantId, type: 'WAREHOUSE', isActive: true },
      });
      if (!item?.unit.trim() || !site)
        throw new BadRequestException('Article WMS et entrepôt actifs requis.');
      // Ratios are captured only on creation. Later mapping edits never rewrite an existing demand.
      let mapping:
        | {
            id: string;
            numerator: string;
            denominator: string;
            commercialUnit: string;
            unit: string;
            updatedAt: string;
          }
        | undefined;
      let convertedQuantity = line.quantity;
      if (!current && dto.mappingId) {
        const configured = await tx.mrpProductMapping.findFirst({
          where: {
            id: dto.mappingId,
            tenantId,
            productId: line.productId ?? '',
            itemId: dto.itemId,
            isActive: true,
          },
        });
        if (!configured || configured.unitSnapshot !== item.unit)
          throw new BadRequestException(
            'Correspondance incompatible avec le produit ou l’unité WMS.',
          );
        if (
          configured.updatedAt.getTime() !== new Date(dto.expectedMappingUpdatedAt ?? '').getTime()
        )
          throw new ConflictException('Le ratio a changé. Rechargez avant de confirmer.');
        try {
          convertedQuantity = new Prisma.Decimal(
            convertMrpCommercialQuantity(
              line.quantity.toFixed(),
              configured.numerator.toFixed(),
              configured.denominator.toFixed(),
            ),
          );
        } catch (e) {
          throw new BadRequestException(e instanceof Error ? e.message : 'Conversion invalide.');
        }
        mapping = {
          id: configured.id,
          numerator: configured.numerator.toFixed(),
          denominator: configured.denominator.toFixed(),
          commercialUnit: configured.commercialUnit,
          unit: configured.unitSnapshot,
          updatedAt: configured.updatedAt.toISOString(),
        };
      }
      if (dto.isActive)
        await this.validateForecast(
          tx,
          tenantId,
          dto.locationId,
          dto.itemId,
          dto.dueDate,
          dto.forecastId,
        );
      const data = {
        dueDate: new Date(`${dto.dueDate}T00:00:00Z`),
        forecastId: dto.forecastId ?? null,
        isActive: dto.isActive,
      };
      if (current) {
        await tx.mrpEntry.updateMany({
          where: { id, tenantId, updatedAt: current.updatedAt },
          data: {
            ...data,
            updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
          },
        });
        return {
          entry: await tx.mrpEntry.findFirstOrThrow({ where: { id, tenantId } }),
          replay: false,
        };
      }
      const snapshot = {
        salesOrderId: line.salesOrderId,
        number: line.salesOrder.number,
        lineName: line.name,
        productId: line.productId,
        quantity: line.quantity.toFixed(),
        convertedQuantity: convertedQuantity.toFixed(),
        ...(mapping ? { mapping } : { oneCommercialUnitEquals: item.unit }),
      };
      return {
        entry: await tx.mrpEntry.create({
          data: {
            tenantId,
            locationId: dto.locationId,
            itemId: dto.itemId,
            kind: 'DEMAND',
            quantity: convertedQuantity,
            reference: `${line.salesOrder.number} · ${line.name}`.slice(0, 200),
            unitSnapshot: item.unit,
            sourceSalesOrderLineId: line.id,
            sourceSnapshot: json(snapshot),
            ...data,
          },
        }),
        replay: false,
      };
    });
    if (!saved.replay)
      await this.audit.log({
        tenantId,
        userId,
        action: id ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'mrp-sales-demand',
        entityId: saved.entry.id,
        after: json(saved.entry),
      });
    return saved.entry;
  }

  async compose(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entries: MrpEntry[],
    permissions: readonly string[],
  ) {
    const linked = entries.filter((e) => e.isActive && e.sourceSalesOrderLineId);
    if (linked.length) await this.requireCrm(tenantId, permissions);
    const lines = linked.length
      ? await tx.salesOrderLineItem.findMany({
          where: { tenantId, id: { in: linked.map((e) => e.sourceSalesOrderLineId!) } },
          include: mrpSourceInclude,
        })
      : [];
    const byId = new Map(lines.map((line) => [line.id, line]));
    const sources: {
      entryId: string;
      salesOrderId: string;
      lineId: string;
      number: string;
      status: string;
      quantity: string;
      itemId: string;
      unit: string | null;
      sourceQuantity: string;
      mapping: unknown;
    }[] = [];
    const demands: PlanningDemand[] = entries.map((e) => {
      let state: PlanningDemand['state'] = 'OPEN';
      if (e.isActive && e.sourceSalesOrderLineId) {
        const line = byId.get(e.sourceSalesOrderLineId);
        const snapshot = e.sourceSnapshot as {
          salesOrderId?: string;
          productId?: string | null;
          quantity?: string;
          mapping?: unknown;
        } | null;
        if (
          !line ||
          line.salesOrder.tenantId !== tenantId ||
          !snapshot ||
          snapshot.salesOrderId !== line.salesOrderId ||
          snapshot.productId !== line.productId ||
          !line.quantity.equals(snapshot.quantity ?? e.quantity)
        )
          throw new BadRequestException(
            'Une source CRM a changé de définition. Désactivez la demande et vérifiez son rattachement.',
          );
        if (line.salesOrder.status === 'DRAFT')
          throw new BadRequestException('Une source CRM n’est plus confirmée.');
        state =
          line.salesOrder.status === 'CANCELLED'
            ? 'CANCELLED'
            : ['FULFILLED', 'INVOICED'].includes(line.salesOrder.status)
              ? 'FULFILLED'
              : 'OPEN';
        sources.push({
          entryId: e.id,
          salesOrderId: line.salesOrderId,
          lineId: line.id,
          number: line.salesOrder.number,
          status: line.salesOrder.status,
          quantity: e.quantity.toFixed(),
          itemId: e.itemId,
          unit: e.unitSnapshot,
          sourceQuantity: snapshot.quantity ?? e.quantity.toFixed(),
          mapping: snapshot.mapping ?? null,
        });
      }
      return {
        id: e.id,
        itemId: e.itemId,
        locationId: e.locationId,
        kind: e.kind,
        quantity: e.quantity.toFixed(),
        dueDate: day(e.dueDate),
        reference: e.reference,
        isActive: e.isActive,
        forecastId: e.forecastId,
        forecastStart: e.forecastStart ? day(e.forecastStart) : null,
        state,
      };
    });
    try {
      return { ...deriveDemandCoverage(demands), sources };
    } catch {
      throw new BadRequestException(
        'Consommation de prévision incompatible. Vérifiez les périodes, articles et sites.',
      );
    }
  }
}
