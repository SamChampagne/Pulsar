import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  coversManufacturingPeriod,
  DOMAIN_EVENT_TYPES,
  MODULE_KEYS,
  MrpSourcingMethod,
  type MrpResult,
  type MrpSnapshot,
} from '@pulsar/shared';
import { ApsClient } from '../../../core/aps/aps.client';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { artifactHash } from '../scheduling/aps-artifact';
import { MrpCalculateDto, MrpEntryDto, MrpPolicyDto } from './mrp.dto';
import { validateMrpResult } from './mrp-result';
import { revisionSummary } from '../boms/boms.service';
import { MrpDemandsService } from './mrp-demands.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const day = (value: Date) => value.toISOString().slice(0, 10);
const version = (previous: Date) => new Date(Math.max(Date.now(), previous.getTime() + 1));

@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly modules: TenantModulesCacheService,
    private readonly aps: ApsClient,
    private readonly audit: AuditLogsService,
    private readonly demands: MrpDemandsService,
    private readonly events: DomainEventsService,
    private readonly settings: ModuleSettingsService,
  ) {}

  private async gate(tenantId: string) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has(MODULE_KEYS.WMS) || !enabled.has(MODULE_KEYS.MANUFACTURING))
      throw new ForbiddenException('Le MRP exige Fabrication et WMS activés.');
  }

  private async site(tx: Prisma.TransactionClient, tenantId: string, locationId: string) {
    const site = await tx.location.findFirst({
      where: { id: locationId, tenantId, type: 'WAREHOUSE', isActive: true },
    });
    if (!site) throw new BadRequestException('Choisir un entrepôt actif de cette entreprise.');
    return site;
  }

  private quantity(value: string, positive = false) {
    const decimal = new Prisma.Decimal(value);
    if (
      !decimal.isFinite() ||
      decimal.lt(0) ||
      decimal.gt(1_000_000_000) ||
      decimal.decimalPlaces() > 3 ||
      (positive && decimal.isZero())
    )
      throw new BadRequestException('Quantité invalide (maximum 1 milliard, 3 décimales).');
    return decimal;
  }

  private checkVersion(current: Date | undefined, expected: string | undefined) {
    if (
      (current && (!expected || current.getTime() !== new Date(expected).getTime())) ||
      (!current && expected)
    )
      throw new ConflictException('Ces données ont changé. Rechargez avant de les modifier.');
  }

  async options(tenantId: string) {
    await this.gate(tenantId);
    const [locations, items, boms] = await Promise.all([
      this.prisma.location.findMany({
        where: { tenantId, type: 'WAREHOUSE', isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { code: 'asc' },
        take: 1001,
      }),
      this.prisma.wmsItem.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, sku: true, name: true, unit: true },
        orderBy: { sku: 'asc' },
        take: 2001,
      }),
      this.prisma.bom.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          productRef: true,
          revisions: {
            where: { tenantId },
            orderBy: { revision: 'desc' },
            take: 30,
            select: revisionSummary,
          },
        },
        orderBy: { code: 'asc' },
        take: 2001,
      }),
    ]);
    if (locations.length > 1000 || items.length > 2000 || boms.length > 2000)
      throw new BadRequestException(
        'Catalogue trop volumineux pour ce poste MRP (2 000 articles/nomenclatures).',
      );
    return { locations, items, boms };
  }

  async workspace(tenantId: string, locationId: string, permissions: readonly string[] = []) {
    await this.gate(tenantId);
    await this.site(this.prisma, tenantId, locationId);
    const [policies, entries, runs, receipts] = await Promise.all([
      this.prisma.mrpItemPolicy.findMany({
        where: { tenantId, locationId },
        orderBy: { itemId: 'asc' },
        take: 2001,
      }),
      this.prisma.mrpEntry.findMany({
        where: { tenantId, locationId },
        include: {
          sourceSalesOrderLine: {
            select: {
              id: true,
              updatedAt: true,
              salesOrder: { select: { id: true, number: true, status: true, updatedAt: true } },
            },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 10001,
      }),
      this.prisma.mrpRun.findMany({
        where: { tenantId, locationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          asOf: true,
          horizonEnd: true,
          proposalCount: true,
          exceptionCount: true,
        },
      }),
      this.prisma.receipt.findMany({
        where: {
          tenantId,
          locationId,
          status: { not: 'CANCELLED' },
          materialPurchaseReceipt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          number: true,
          status: true,
          lines: { where: { tenantId }, select: { itemId: true, qty: true } },
        },
      }),
    ]);
    if (policies.length > 2000 || entries.length > 10000)
      throw new BadRequestException('Périmètre MRP trop volumineux.');
    if (entries.some((e) => e.sourceSalesOrderLineId))
      await this.demands.requireCrm(tenantId, permissions);
    let coverage = null,
      coverageError: string | null = null;
    try {
      coverage = await this.demands.compose(this.prisma, tenantId, entries, permissions);
    } catch (e) {
      coverageError =
        e instanceof BadRequestException ? e.message : 'Couverture des prévisions indisponible.';
    }
    return { policies, entries, runs, receipts, coverage, coverageError };
  }

  async savePolicy(tenantId: string, userId: string, dto: MrpPolicyDto) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwnedIfSet('bom', dto.bomId, tenantId);
    await this.ownership.assertOwnedIfSet('bomRevision', dto.bomRevisionId, tenantId);
    if (dto.method === 'MAKE' ? !dto.bomId || !dto.bomRevisionId : dto.bomId || dto.bomRevisionId)
      throw new BadRequestException(
        'Fabriquer exige une nomenclature et une version publiée explicite. Acheter ne doit pas en référencer.',
      );
    const data = {
      method: dto.method,
      bomId: dto.bomId ?? null,
      bomRevisionId: dto.bomRevisionId ?? null,
      leadDays: dto.leadDays,
      safetyStock: this.quantity(dto.safetyStock),
      minimumOrder: this.quantity(dto.minimumOrder),
      orderMultiple: this.quantity(dto.orderMultiple, true),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.site(tx, tenantId, dto.locationId);
      const item = await tx.wmsItem.findFirst({
        where: { id: dto.itemId, tenantId, isActive: true },
      });
      if (!item) throw new BadRequestException('Article inactif.');
      if (dto.bomId) {
        const bom = await tx.bomRevision.findFirst({
          where: {
            id: dto.bomRevisionId,
            bomId: dto.bomId,
            tenantId,
            bom: { tenantId, isActive: true },
          },
          include: { lines: { where: { tenantId } } },
        });
        if (
          !bom ||
          bom.outputItemId !== item.id ||
          bom.outputUnit !== item.unit ||
          !bom.lines.length
        )
          throw new BadRequestException(
            'La version publiée doit correspondre à cet article et à son unité.',
          );
      }
      const key = { tenantId, locationId: dto.locationId, itemId: dto.itemId };
      const current = await tx.mrpItemPolicy.findUnique({
        where: { tenantId_locationId_itemId: key },
      });
      this.checkVersion(current?.updatedAt, dto.expectedUpdatedAt);
      return tx.mrpItemPolicy.upsert({
        where: { tenantId_locationId_itemId: key },
        create: { ...key, ...data, unitSnapshot: item.unit },
        update: {
          ...data,
          unitSnapshot: item.unit,
          updatedAt: version(current?.updatedAt ?? new Date(0)),
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'mrp-policy',
      entityId: result.id,
      after: json(result),
    });
    return result;
  }

  async saveEntry(tenantId: string, userId: string, dto: MrpEntryDto, id?: string) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwnedIfSet('receipt', dto.receiptId, tenantId);
    await this.ownership.assertOwnedIfSet('mrpEntry', dto.forecastId, tenantId);
    const quantity = this.quantity(dto.quantity, true);
    if (dto.receiptId && dto.kind !== 'SUPPLY')
      throw new BadRequestException('Seul un arrivage peut référencer une réception.');
    if (dto.forecastId && dto.kind !== 'DEMAND')
      throw new BadRequestException('Seule une demande ferme peut consommer une prévision.');
    if (
      dto.kind === 'FORECAST'
        ? !dto.forecastStart || dto.forecastStart > dto.dueDate
        : dto.forecastStart
    )
      throw new BadRequestException(
        'Une prévision exige une période valide; les autres entrées n’ont pas de début de prévision.',
      );
    const result = await this.prisma.$transaction(async (tx) => {
      // Same tenant lock as WMS document writers: receipt proof and quantity are read coherently.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      await this.site(tx, tenantId, dto.locationId);
      const item = await tx.wmsItem.findFirst({
        where: { id: dto.itemId, tenantId, isActive: true },
      });
      if (!item) throw new BadRequestException('Article inactif.');
      const current = id ? await tx.mrpEntry.findFirst({ where: { id, tenantId } }) : null;
      if (id && !current) throw new NotFoundException('Entrée MRP introuvable.');
      if (current?.sourceSalesOrderLineId)
        throw new ConflictException(
          'Utilisez le parcours de demande CRM : la quantité source ne se modifie pas manuellement.',
        );
      this.checkVersion(current?.updatedAt, dto.expectedUpdatedAt);
      if (
        current &&
        (current.itemId !== dto.itemId ||
          current.locationId !== dto.locationId ||
          current.kind !== dto.kind)
      )
        throw new BadRequestException(
          'Article, type et entrepôt sont immuables. Désactivez cette entrée et créez-en une autre.',
        );
      if (dto.isActive)
        await this.demands.validateForecast(
          tx,
          tenantId,
          dto.locationId,
          dto.itemId,
          dto.dueDate,
          dto.forecastId,
        );
      if (current?.kind === 'FORECAST' && dto.isActive) {
        const incompatible = await tx.mrpEntry.count({
          where: {
            tenantId,
            forecastId: current.id,
            isActive: true,
            OR: [
              { dueDate: { lt: new Date(`${dto.forecastStart}T00:00:00Z`) } },
              { dueDate: { gt: new Date(`${dto.dueDate}T00:00:00Z`) } },
            ],
          },
        });
        if (incompatible)
          throw new ConflictException(
            'Cette période exclurait une demande liée. Modifiez d’abord ses rattachements.',
          );
      }
      if (dto.receiptId) {
        if (
          await tx.materialPurchaseReceipt.count({ where: { tenantId, receiptId: dto.receiptId } })
        )
          throw new BadRequestException(
            'Cette réception appartient déjà à un achat matières : son arrivage est calculé automatiquement.',
          );
        const receipt = await tx.receipt.findFirst({
          where: { id: dto.receiptId, tenantId, locationId: dto.locationId },
          include: { lines: { where: { tenantId, itemId: dto.itemId } } },
        });
        if (!receipt || receipt.status === 'CANCELLED' || !receipt.lines.length)
          throw new BadRequestException('Réception incompatible (site, article ou statut).');
        const duplicate = await tx.mrpEntry.findFirst({
          where: {
            tenantId,
            receiptId: dto.receiptId,
            itemId: dto.itemId,
            ...(id ? { id: { not: id } } : {}),
          },
        });
        if (duplicate)
          throw new ConflictException(
            'Cette réception est déjà rattachée à un arrivage pour cet article.',
          );
      }
      const data = {
        locationId: dto.locationId,
        forecastId: dto.forecastId ?? null,
        forecastStart: dto.forecastStart ? new Date(`${dto.forecastStart}T00:00:00Z`) : null,
        itemId: dto.itemId,
        kind: dto.kind,
        quantity,
        unitSnapshot: item.unit,
        dueDate: new Date(`${dto.dueDate}T00:00:00.000Z`),
        reference: dto.reference.trim(),
        isActive: dto.isActive,
        receiptId: dto.receiptId ?? null,
      };
      if (!data.reference) throw new BadRequestException('Référence obligatoire.');
      if (current) {
        await tx.mrpEntry.updateMany({
          where: { id, tenantId, updatedAt: current.updatedAt },
          data: { ...data, updatedAt: version(current.updatedAt) },
        });
        return tx.mrpEntry.findFirstOrThrow({ where: { id, tenantId } });
      }
      return tx.mrpEntry.create({ data: { tenantId, ...data } });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: id ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'mrp-entry',
      entityId: result.id,
      after: json(result),
    });
    return result;
  }

  /** Repeatable-read snapshot, scoped to ONE warehouse. No mutations or stock reservations. */
  private async capture(
    tenantId: string,
    locationId: string,
    asOf: string,
    horizonEnd: string,
    permissions: readonly string[],
  ) {
    return this.prisma.$transaction(
      (tx) => this.captureInTransaction(tx, tenantId, locationId, asOf, horizonEnd, permissions),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }

  /** Caller must use a repeatable read, or hold the shared tenant writer lock. */
  async captureInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationId: string,
    asOf: string,
    horizonEnd: string,
    permissions: readonly string[],
  ) {
    await this.site(tx, tenantId, locationId);
    const policies = await tx.mrpItemPolicy.findMany({
      where: { tenantId, locationId },
      include: {
        item: true,
        bomRevision: { include: { lines: { where: { tenantId }, orderBy: { id: 'asc' } } } },
      },
      orderBy: { itemId: 'asc' },
      take: 2001,
    });
    if (!policies.length || policies.length > 2000)
      throw new BadRequestException('Configurer de 1 à 2 000 articles MRP pour cet entrepôt.');
    const entries = await tx.mrpEntry.findMany({
      where: {
        tenantId,
        locationId,
        isActive: true,
      },
      include: {
        receipt: { include: { lines: { where: { tenantId }, orderBy: { id: 'asc' } } } },
      },
      orderBy: { id: 'asc' },
      take: 10001,
    });
    if (entries.length > 10000)
      throw new BadRequestException('Maximum 10 000 entrées actives par calcul.');
    const coverage = await this.demands.compose(tx, tenantId, entries, permissions);
    const levels = await tx.inventoryLevel.groupBy({
      by: ['itemId'],
      where: {
        tenantId,
        itemId: { in: policies.map((p) => p.itemId) },
        bin: { tenantId, locationId, isActive: true },
      },
      _sum: { qtyOnHand: true },
    });
    const balances = new Map(
      levels.map((level) => [level.itemId, level._sum.qtyOnHand ?? new Prisma.Decimal(0)]),
    );
    const byId = new Map(policies.map((p) => [p.itemId, p]));
    const snapshot: MrpSnapshot = {
      version: 'pulsar.mrp.v1',
      as_of: asOf,
      horizon_end: horizonEnd,
      demands: [],
      supplies: [],
      items: [],
    };
    for (const p of policies) {
      if (p.item.tenantId !== tenantId || !p.item.isActive || p.unitSnapshot !== p.item.unit)
        throw new BadRequestException(
          `Article inactif ou unité modifiée : ${p.item.sku}. Revalider sa règle.`,
        );
      if (
        p.method === 'MAKE' &&
        (!p.bomRevision ||
          p.bomRevision.tenantId !== tenantId ||
          p.bomRevision.bomId !== p.bomId ||
          p.bomRevision.outputItemId !== p.itemId ||
          p.bomRevision.outputUnit !== p.item.unit ||
          !p.bomRevision.lines.length)
      )
        throw new BadRequestException(
          `Sélectionner une version publiée compatible pour ${p.item.sku}.`,
        );
      const onHand = balances.get(p.itemId) ?? new Prisma.Decimal(0);
      if (
        p.method === 'MAKE' &&
        !coversManufacturingPeriod(
          {
            validFrom: p.bomRevision!.validFrom?.toISOString(),
            validUntil: p.bomRevision!.validUntil?.toISOString(),
          },
          asOf,
          horizonEnd,
        )
      )
        throw new BadRequestException(
          `La version de ${p.item.sku} ne couvre pas tout l'horizon. Choisir une version ou réduire la période.`,
        );
      const components = (p.method === 'MAKE' ? p.bomRevision!.lines : []).map((line) => {
        const child = byId.get(line.itemId);
        if (!child || child.item.unit !== line.unit)
          throw new BadRequestException(
            `Configurer le composant ${line.sku} de ${p.item.sku} avec son unité publiée dans cet entrepôt.`,
          );
        if (!line.quantityPerUnit.isFinite() || line.quantityPerUnit.lte(0))
          throw new BadRequestException(`Quantité de nomenclature invalide : ${line.sku}.`);
        return {
          item_id: child.itemId,
          quantity: new Prisma.Decimal(line.quantityPerUnit.toString()).toFixed(),
        };
      });
      snapshot.items.push({
        id: p.itemId,
        sku: p.item.sku,
        name: p.item.name,
        unit: p.item.unit,
        method: p.method as MrpSourcingMethod,
        on_hand: onHand.toFixed(),
        safety_stock: p.safetyStock.toFixed(),
        minimum_order: p.minimumOrder.toFixed(),
        order_multiple: p.orderMultiple.toFixed(),
        lead_days: p.leadDays,
        components,
      });
    }
    for (const entry of entries) {
      const p = byId.get(entry.itemId);
      if (!p || p.item.unit !== entry.unitSnapshot)
        throw new BadRequestException(
          `Règle absente ou unité modifiée pour l'entrée « ${entry.reference} ».`,
        );
      if (entry.kind !== 'SUPPLY' || day(entry.dueDate) > horizonEnd) continue;
      let quantity = entry.quantity;
      if (entry.receipt) {
        if (entry.receipt.tenantId !== tenantId || entry.receipt.locationId !== locationId)
          throw new BadRequestException('Réception liée incompatible.');
        if (entry.receipt.status === 'CANCELLED')
          throw new BadRequestException(
            `Réception annulée pour « ${entry.reference} ». Corriger l'arrivage.`,
          );
        if (entry.receipt.status === 'POSTED') {
          const received = entry.receipt.lines
            .filter((l) => l.itemId === entry.itemId)
            .reduce((sum, l) => sum.plus(l.qty), new Prisma.Decimal(0));
          quantity = Prisma.Decimal.max(0, quantity.minus(received));
        }
      }
      if (quantity.isZero()) continue;
      snapshot.supplies.push({
        id: entry.id,
        item_id: entry.itemId,
        quantity: quantity.toFixed(),
        date: day(entry.dueDate),
        reference: entry.reference,
      });
    }
    snapshot.demands = coverage.demands.filter((d) => d.date <= horizonEnd);
    const purchases = await tx.materialPurchaseOrder.findMany({
      where: {
        tenantId,
        status: 'CONFIRMED',
        preparation: { tenantId, locationId },
        expectedDate: { lte: new Date(horizonEnd) },
      },
      include: {
        preparation: true,
        receipts: {
          where: { tenantId },
          include: { receipt: { include: { lines: { where: { tenantId } } } } },
        },
      },
      orderBy: { id: 'asc' },
      take: 10001,
    });
    if (purchases.length > 10000)
      throw new BadRequestException('Maximum 10 000 commandes matières par calcul.');
    const materialPurchases = purchases.map((order) => {
      const prep = order.preparation,
        policy = byId.get(prep.itemId);
      const received = order.receipts
        .filter((r) => r.receipt.status === 'POSTED')
        .reduce(
          (sum, r) =>
            sum.plus(
              r.receipt.lines
                .filter((l) => l.itemId === prep.itemId)
                .reduce((s, l) => s.plus(l.qty), new Prisma.Decimal(0)),
            ),
          new Prisma.Decimal(0),
        );
      const remaining = Prisma.Decimal.max(
        0,
        prep.quantity.minus(received).minus(order.closedQuantity),
      );
      if (remaining.gt(0)) {
        if (!policy || policy.unitSnapshot !== prep.unitSnapshot || prep.status !== 'DRAFT')
          throw new BadRequestException(`Règle/unité incompatible avec ${order.number}.`);
        snapshot.supplies.push({
          id: `purchase:${order.id}`,
          item_id: prep.itemId,
          quantity: remaining.toFixed(),
          date: day(order.expectedDate),
          reference: order.number,
        });
      }
      return {
        id: order.id,
        number: order.number,
        itemId: prep.itemId,
        quantity: prep.quantity.toFixed(),
        received: received.toFixed(),
        closedQuantity: order.closedQuantity.toFixed(),
        closedAt: order.closedAt?.toISOString() ?? null,
        remaining: remaining.toFixed(),
        unit: prep.unitSnapshot,
        expectedDate: day(order.expectedDate),
        receipts: order.receipts
          .filter((r) => r.receipt.status === 'POSTED')
          .map((r) => ({ id: r.receipt.id, number: r.receipt.number })),
      };
    });
    const actuals = await tx.manufacturingDeclaration.findMany({
      where: { tenantId, order: { tenantId, locationId } },
      include: { order: { select: { id: true, number: true, status: true } } },
      orderBy: { id: 'asc' },
      take: 10001,
    });
    if (actuals.length > 10000)
      throw new BadRequestException('Maximum 10 000 déclarations dans ce snapshot.');
    const productionDeclarations = actuals.map((d) => ({
      id: d.id,
      orderId: d.orderId,
      orderNumber: d.order.number,
      orderStatus: d.order.status,
      goodQuantity: d.goodQuantity,
      scrapQuantity: d.scrapQuantity,
      createdAt: d.createdAt.toISOString(),
      evidence: d.evidence,
    }));
    const sourceMetadata = {
      productionDeclarations,
      materialPurchases,
      forecastCoverage: coverage.forecasts,
      salesDemands: coverage.sources,
      bomRevisions: policies
        .filter((p) => p.method === 'MAKE')
        .map((p) => ({
          itemId: p.itemId,
          bomId: p.bomId,
          revisionId: p.bomRevision!.id,
          revision: p.bomRevision!.revision,
          contentHash: p.bomRevision!.contentHash,
        })),
    };
    return { snapshot, sourceMetadata, sourceHash: artifactHash({ snapshot, sourceMetadata }) };
  }

  async calculate(
    tenantId: string,
    userId: string,
    dto: MrpCalculateDto,
    permissions: readonly string[] = [],
    notifyReview = true,
  ) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    const asOf = day(new Date());
    const span =
      (new Date(`${dto.horizonEnd}T00:00:00Z`).getTime() -
        new Date(`${asOf}T00:00:00Z`).getTime()) /
      86400000;
    if (!Number.isFinite(span) || span < 0 || span > 730)
      throw new BadRequestException('Horizon : aujourd’hui à 730 jours maximum (dates UTC).');
    const { snapshot, sourceHash, sourceMetadata } = await this.capture(
      tenantId,
      dto.locationId,
      asOf,
      dto.horizonEnd,
      permissions,
    );
    const result = validateMrpResult(
      await this.aps.calculateMrp(tenantId, snapshot),
      tenantId,
      snapshot,
    );
    const run = await this.prisma.mrpRun.create({
      data: {
        tenantId,
        locationId: dto.locationId,
        createdById: userId,
        asOf: new Date(`${asOf}T00:00:00Z`),
        horizonEnd: new Date(`${dto.horizonEnd}T00:00:00Z`),
        sourceHash,
        inputSnapshot: json(snapshot),
        sourceMetadata: json(sourceMetadata),
        result: json(result),
        proposalCount: result.proposals.length,
        exceptionCount: result.exceptions.length,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'mrp-run',
      entityId: run.id,
      after: { sourceHash, proposalCount: run.proposalCount },
    });
    // Opt-in, best-effort. An agent-triggered recalculation never wakes itself again.
    if (notifyReview && run.exceptionCount > 0) {
      const settings = await this.settings.resolve(tenantId, 'manufacturing').catch(() => ({}));
      if ('mrpAutomaticReview' in settings && settings.mrpAutomaticReview === true) {
        await this.events.emit(
          tenantId,
          DOMAIN_EVENT_TYPES.MRP_REVIEW_REQUESTED,
          { type: 'mrp-run', id: run.id },
          {
            runId: run.id,
            exceptionCount: run.exceptionCount,
            requiresCrm: Boolean(
              (sourceMetadata as { salesDemands?: unknown[] }).salesDemands?.length,
            ),
          },
        );
      }
    }
    return this.getRun(tenantId, run.id, permissions);
  }

  async getRun(tenantId: string, id: string, permissions: readonly string[] = []) {
    const run = await this.assertRunAccess(tenantId, id, permissions);
    return this.withFreshness(tenantId, run, permissions);
  }

  async assertRunAccess(tenantId: string, id: string, permissions: readonly string[]) {
    await this.gate(tenantId);
    const run = await this.prisma.mrpRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Calcul MRP introuvable.');
    const metadata = run.sourceMetadata as { salesDemands?: unknown[] } | null;
    if (metadata?.salesDemands?.length) await this.demands.requireCrm(tenantId, permissions);
    return run;
  }

  private async withFreshness(
    tenantId: string,
    run: Awaited<ReturnType<MrpService['assertRunAccess']>>,
    permissions: readonly string[],
  ) {
    let stale = true;
    let staleReason: string | null = null;
    try {
      const current = await this.capture(
        tenantId,
        run.locationId,
        day(new Date()),
        day(run.horizonEnd),
        permissions,
      );
      stale = current.sourceHash !== run.sourceHash;
      if (stale)
        staleReason =
          'Les données ou la date de référence ont changé. Recalculer avant toute décision.';
    } catch (error) {
      staleReason =
        error instanceof BadRequestException
          ? error.message
          : 'Fraîcheur non vérifiable actuellement.';
    }
    return { ...run, result: run.result as unknown as MrpResult, stale, staleReason };
  }
}
