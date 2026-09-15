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
  MODULE_KEYS,
  MrpEntryKind,
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
        select: { id: true, code: true, name: true, productRef: true },
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

  async workspace(tenantId: string, locationId: string) {
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
        where: { tenantId, locationId, status: { not: 'CANCELLED' } },
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
    return { policies, entries, runs, receipts };
  }

  async savePolicy(tenantId: string, userId: string, dto: MrpPolicyDto) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.ownership.assertOwned('wmsItem', dto.itemId, tenantId);
    await this.ownership.assertOwnedIfSet('bom', dto.bomId, tenantId);
    if ((dto.method === 'MAKE') !== Boolean(dto.bomId))
      throw new BadRequestException('Une nomenclature est obligatoire uniquement pour Fabriquer.');
    const data = {
      method: dto.method,
      bomId: dto.bomId ?? null,
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
        const bom = await tx.bom.findFirst({
          where: { id: dto.bomId, tenantId, isActive: true },
          include: { lines: true },
        });
        if (!bom || bom.productRef !== item.sku || !bom.lines.length)
          throw new BadRequestException(
            'La nomenclature doit être active, non vide et son produit doit correspondre exactement au SKU.',
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
    const quantity = this.quantity(dto.quantity, true);
    if (dto.receiptId && dto.kind !== 'SUPPLY')
      throw new BadRequestException('Seul un arrivage peut référencer une réception.');
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
      if (dto.receiptId) {
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
  private async capture(tenantId: string, locationId: string, asOf: string, horizonEnd: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.site(tx, tenantId, locationId);
        const policies = await tx.mrpItemPolicy.findMany({
          where: { tenantId, locationId },
          include: {
            item: true,
            bom: { include: { lines: { where: { tenantId }, orderBy: { id: 'asc' } } } },
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
            dueDate: { lte: new Date(`${horizonEnd}T00:00:00Z`) },
          },
          include: {
            receipt: { include: { lines: { where: { tenantId }, orderBy: { id: 'asc' } } } },
          },
          orderBy: { id: 'asc' },
          take: 10001,
        });
        if (entries.length > 10000)
          throw new BadRequestException('Maximum 10 000 entrées actives par calcul.');
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
        const bySku = new Map(policies.map((p) => [p.item.sku, p]));
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
            (!p.bom ||
              p.bom.tenantId !== tenantId ||
              !p.bom.isActive ||
              p.bom.productRef !== p.item.sku ||
              !p.bom.lines.length)
          )
            throw new BadRequestException(`Nomenclature absente ou incompatible : ${p.item.sku}.`);
          const onHand = balances.get(p.itemId) ?? new Prisma.Decimal(0);
          const components = (p.method === 'MAKE' ? p.bom!.lines : []).map((line) => {
            const child = bySku.get(line.materialRef);
            if (!child)
              throw new BadRequestException(
                `Configurer le composant ${line.materialRef} de ${p.item.sku} dans cet entrepôt.`,
              );
            if (!Number.isFinite(line.quantityPerUnit) || line.quantityPerUnit <= 0)
              throw new BadRequestException(
                `Quantité de nomenclature invalide : ${line.materialRef}.`,
              );
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
          snapshot[entry.kind === MrpEntryKind.DEMAND ? 'demands' : 'supplies'].push({
            id: entry.id,
            item_id: entry.itemId,
            quantity: quantity.toFixed(),
            date: day(entry.dueDate),
            reference: entry.reference,
          });
        }
        return { snapshot, sourceHash: artifactHash(snapshot) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }

  async calculate(tenantId: string, userId: string, dto: MrpCalculateDto) {
    await this.gate(tenantId);
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    const asOf = day(new Date());
    const span =
      (new Date(`${dto.horizonEnd}T00:00:00Z`).getTime() -
        new Date(`${asOf}T00:00:00Z`).getTime()) /
      86400000;
    if (!Number.isFinite(span) || span < 0 || span > 730)
      throw new BadRequestException('Horizon : aujourd’hui à 730 jours maximum (dates UTC).');
    const { snapshot, sourceHash } = await this.capture(
      tenantId,
      dto.locationId,
      asOf,
      dto.horizonEnd,
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
    return this.getRun(tenantId, run.id);
  }

  async getRun(tenantId: string, id: string) {
    await this.gate(tenantId);
    const run = await this.prisma.mrpRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Calcul MRP introuvable.');
    let stale = true;
    let staleReason: string | null = null;
    try {
      const current = await this.capture(
        tenantId,
        run.locationId,
        day(new Date()),
        day(run.horizonEnd),
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
