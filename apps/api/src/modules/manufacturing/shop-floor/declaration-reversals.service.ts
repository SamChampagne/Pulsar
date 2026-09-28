import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, StockMovementType } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { InventoryService } from '../../wms/inventory/inventory.service';
import { nextWmsVersion } from '../../wms/document-operations';
import { artifactHash } from '../scheduling/aps-artifact';
import { ReverseDeclarationDto } from './shop-floor.dto';

@Injectable()
export class DeclarationReversalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditLogsService,
  ) {}

  private async gate(tenantId: string) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has('manufacturing') || !enabled.has('wms'))
      throw new ForbiddenException('Fabrication et WMS requis.');
  }

  // Read-only assessment. The writer repeats it under the same tenant lock as all stock writers.
  private async assess(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    declarationId: string,
  ) {
    const d = await tx.manufacturingDeclaration.findFirst({
      where: { tenantId, id: declarationId, orderId, order: { tenantId } },
      include: { reversal: true, order: { include: { location: true } } },
    });
    if (!d) throw new NotFoundException('Déclaration introuvable.');
    const reasons: string[] = [];
    if (d.reversal) reasons.push('Cette déclaration a déjà été contrepassée.');
    if (d.order.status !== 'IN_PROGRESS')
      reasons.push('Seul un OF en cours peut être corrigé. Aucun OF terminé n’est rouvert.');
    if (!d.order.location?.isActive || d.order.location.type !== 'WAREHOUSE')
      reasons.push('Le site de l’OF doit être un entrepôt actif.');
    const proof = d.evidence as any;
    const rows = await tx.stockMovement.findMany({
      where: { tenantId, refType: 'manufacturing-declaration', refId: d.id },
      orderBy: { id: 'asc' },
      include: { item: true, fromBin: true, toBin: true, lot: true },
    });
    const captured = Array.isArray(proof?.movements) ? proof.movements : [];
    if (
      proof?.version !== 2 ||
      proof.locationId !== d.order.locationId ||
      captured.length !== rows.length ||
      captured.some((m: any) => !m || typeof m.id !== 'string') ||
      new Set(captured.map((m: any) => m?.id)).size !== rows.length
    )
      reasons.push('Preuve v2 complète requise : aucun mouvement historique n’est reconstitué.');
    const effects: {
      movementId: string;
      itemId: string;
      sku: string;
      name: string;
      unit: string;
      binId: string;
      binCode: string;
      lotId: string | null;
      lotCode: string | null;
      quantity: string;
      direction: 'IN' | 'OUT';
      available: string;
    }[] = [];
    for (const m of rows) {
      const c = captured.find((c: any) => c?.id === m.id);
      const outgoing = m.type === 'PRODUCTION';
      if (outgoing && m.lot?.disposition === 'QUARANTINED')
        reasons.push(`Lot produit ${m.lot.code} en quarantaine : retrait compensatoire interdit.`);
      const bin = outgoing ? m.toBin : m.fromBin;
      if (
        !['PRODUCTION', 'CONSUMPTION'].includes(m.type) ||
        !bin ||
        (outgoing ? m.fromBinId !== null : m.toBinId !== null) ||
        !c ||
        c.itemId !== m.itemId ||
        c.type !== m.type ||
        c.binId !== bin.id ||
        c.unit !== m.unitSnapshot ||
        c.quantity !== m.qty.toFixed() ||
        (c.lot?.id ?? null) !== m.lotId ||
        m.item.tenantId !== tenantId ||
        bin.tenantId !== tenantId
      ) {
        reasons.push('Le journal ne correspond pas à la preuve figée. Correction refusée.');
        continue;
      }
      if (
        !m.item.isActive ||
        m.item.unit !== m.unitSnapshot ||
        m.item.sku !== c.sku ||
        !bin.isActive ||
        bin.locationId !== d.order.locationId
      )
        reasons.push(
          'Un article, une unité ou un emplacement n’est plus compatible avec la preuve.',
        );
      const total = await tx.inventoryLevel.findFirst({
        where: { tenantId, itemId: m.itemId, binId: bin.id },
      });
      const lot = m.lotId
        ? await tx.wmsLotBalance.findFirst({
            where: { tenantId, itemId: m.itemId, lotId: m.lotId, binId: bin.id },
          })
        : null;
      const available = m.lotId
        ? Prisma.Decimal.min(total?.qtyOnHand ?? 0, lot?.qtyOnHand ?? 0)
        : new Prisma.Decimal(total?.qtyOnHand ?? 0);
      if (outgoing && available.lt(m.qty))
        reasons.push(
          'Le produit fini n’est plus disponible en quantité suffisante dans son lot et son emplacement d’origine.',
        );
      effects.push({
        movementId: m.id,
        itemId: m.itemId,
        sku: c.sku,
        name: c.name,
        unit: c.unit,
        binId: bin.id,
        binCode: c.binCode,
        lotId: m.lotId,
        lotCode: c.lot?.code ?? null,
        quantity: m.qty.toFixed(),
        direction: outgoing ? 'OUT' : 'IN',
        available: available.toFixed(),
      });
    }
    const production = rows.filter((m) => m.type === 'PRODUCTION');
    if (
      production.length !== (d.goodQuantity > 0 ? 1 : 0) ||
      production.some((m) => !m.qty.eq(d.goodQuantity) || m.itemId !== proof?.product?.itemId)
    )
      reasons.push('Quantité produite incompatible avec la déclaration.');
    const plan = {
      declarationId: d.id,
      orderId,
      expectedUpdatedAt: d.order.updatedAt.toISOString(),
      goodQuantity: d.goodQuantity,
      scrapQuantity: d.scrapQuantity,
      effects,
      blockedReasons: [...new Set(reasons)],
    };
    return { ...plan, reviewToken: artifactHash({ plan, evidence: d.evidence }) };
  }

  async preview(tenantId: string, orderId: string, declarationId: string) {
    await this.gate(tenantId);
    return this.prisma.$transaction((tx) => this.assess(tx, tenantId, orderId, declarationId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    });
  }

  async reverse(
    tenantId: string,
    userId: string,
    orderId: string,
    declarationId: string,
    dto: ReverseDeclarationDto,
  ) {
    await this.gate(tenantId);
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Motif de correction obligatoire.');
    const fingerprint = artifactHash({ tenantId, userId, orderId, declarationId, ...dto });
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const known = await tx.manufacturingDeclarationReversal.findFirst({
          where: { tenantId, operationKey: dto.operationKey },
        });
        if (known) {
          if (known.fingerprint !== fingerprint)
            throw new ConflictException('Clé liée à une autre correction.');
          return { id: known.id, replayed: true };
        }
        const plan = await this.assess(tx, tenantId, orderId, declarationId);
        if (plan.blockedReasons.length) throw new ConflictException(plan.blockedReasons.join(' '));
        if (
          plan.expectedUpdatedAt !== dto.expectedUpdatedAt ||
          plan.reviewToken !== dto.reviewToken
        )
          throw new ConflictException(
            'L’OF ou le stock a changé. Relisez les effets avant de confirmer.',
          );
        const record = await tx.manufacturingDeclarationReversal.create({
          data: {
            tenantId,
            declarationId,
            createdById: userId,
            operationKey: dto.operationKey,
            fingerprint,
            reason: dto.reason,
            evidence: {},
          },
        });
        const movements = [];
        // Withdraw the finished product first; a component return never finances that withdrawal.
        for (const effect of [...plan.effects].sort((a, b) =>
          a.direction === b.direction ? 0 : a.direction === 'OUT' ? -1 : 1,
        )) {
          const m = await this.inventory.postMovement(tx, {
            tenantId,
            userId,
            type: StockMovementType.ADJUSTMENT,
            itemId: effect.itemId,
            lotId: effect.lotId,
            ...(effect.direction === 'OUT'
              ? { fromBinId: effect.binId }
              : { toBinId: effect.binId }),
            qty: new Prisma.Decimal(effect.quantity).toNumber(),
            refType: 'manufacturing-reversal',
            refId: record.id,
            note: dto.reason,
          });
          movements.push({ ...effect, compensationMovementId: m.id });
        }
        await tx.manufacturingDeclarationReversal.update({
          where: { id: record.id, tenantId },
          data: {
            evidence: {
              version: 1,
              declarationId,
              orderId,
              goodQuantity: plan.goodQuantity,
              scrapQuantity: plan.scrapQuantity,
              reviewToken: plan.reviewToken,
              movements,
            },
          },
        });
        await tx.manufacturingOrder.update({
          where: { id: orderId, tenantId },
          data: { updatedAt: nextWmsVersion(new Date(plan.expectedUpdatedAt)) },
        });
        return { id: record.id, replayed: false };
      },
      { timeout: 20000 },
    );
    if (!result.replayed)
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'manufacturing-reversal',
        entityId: result.id,
        after: { orderId, declarationId, reason: dto.reason },
      });
    return result;
  }
}
