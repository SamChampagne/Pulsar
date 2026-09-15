import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  coversManufacturingPeriod,
  canTransitionMrpPreparation,
  MrpPreparationStatus,
  type MrpResult,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { MrpService } from './mrp.service';
import { OrdersService } from '../orders/orders.service';
import { artifactHash } from '../scheduling/aps-artifact';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';

const day = (date: Date) => date.toISOString().slice(0, 10);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const projection = {
  id: true,
  runId: true,
  proposalId: true,
  number: true,
  method: true,
  status: true,
  locationId: true,
  itemId: true,
  quantity: true,
  unitSnapshot: true,
  dueDate: true,
  releaseDate: true,
  createdAt: true,
  updatedAt: true,
  manufacturingOrderId: true,
  manufacturingOrder: { select: { id: true, number: true, status: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
} as const;

@Injectable()
export class MrpPreparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mrp: MrpService,
    private readonly orders: OrdersService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, runId: string, permissions: readonly string[], query: ListQueryDto) {
    await this.mrp.getRun(tenantId, runId, permissions);
    const { page, pageSize, skip, take } = paginationArgs(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mrpPreparation.findMany({
        where: { tenantId, runId },
        select: projection,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.mrpPreparation.count({ where: { tenantId, runId } }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async preview(
    tenantId: string,
    runId: string,
    proposalId: string,
    permissions: readonly string[],
  ) {
    // Includes module and historical CRM authorization, not just tenant ownership.
    await this.mrp.getRun(tenantId, runId, permissions);
    return this.prisma.$transaction(
      (tx) => this.inspect(tx, tenantId, runId, proposalId, permissions),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }

  private async inspect(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    proposalId: string,
    permissions: readonly string[],
  ) {
    const run = await tx.mrpRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Calcul MRP introuvable.');
    const result = run.result as unknown as MrpResult;
    const proposal = result.proposals.find((p) => p.id === proposalId);
    const item = result.items.find((i) => i.item_id === proposal?.item_id);
    if (!proposal || !item) throw new NotFoundException('Proposition introuvable dans ce calcul.');
    const existing = await tx.mrpPreparation.findFirst({
      where: { tenantId, runId, proposalId },
      select: projection,
    });
    const blockers: string[] = [];
    let currentHash: string | null = null;
    let coveredPurchases: string[] = [];
    try {
      const current = await this.mrp.captureInTransaction(
        tx,
        tenantId,
        run.locationId,
        day(new Date()),
        day(run.horizonEnd),
        permissions,
      );
      currentHash = current.sourceHash;
      coveredPurchases = current.sourceMetadata.materialPurchases.map((p) => p.id);
      if (currentHash !== run.sourceHash)
        blockers.push('Le calcul est périmé. Recalculez avant de préparer un document.');
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      blockers.push(e.message);
    }
    if (existing)
      blockers.push('Cette proposition possède déjà un document. Consultez-le ci-dessous.');
    // Until production/receipts reconcile these drafts, never silently purchase or
    // manufacture twice after a new calculation. Other proposals in THIS run remain usable.
    const reconciledOrders = (
      (
        run.sourceMetadata as {
          productionDeclarations?: { orderId: string; orderStatus: string }[];
        } | null
      )?.productionDeclarations ?? []
    )
      .filter((d) => d.orderStatus === 'COMPLETED')
      .map((d) => d.orderId);
    const pending = await tx.mrpPreparation.count({
      where: {
        tenantId,
        locationId: run.locationId,
        itemId: proposal.item_id,
        runId: { not: runId },
        OR: [
          {
            method: 'BUY',
            status: 'DRAFT',
            OR: [{ purchaseOrder: null }, { purchaseOrder: { id: { notIn: coveredPurchases } } }],
          },
          {
            method: 'MAKE',
            manufacturingOrder: {
              tenantId,
              status: { not: 'CANCELLED' },
              id: { notIn: reconciledOrders },
            },
          },
        ],
      },
    });
    if (pending)
      blockers.push(
        'Un autre calcul possède déjà une préparation non annulée pour cet article et ce site. Rapprochez les documents existants avant de relancer; aucun doublon ne sera créé.',
      );
    const quantity = new Prisma.Decimal(proposal.quantity);
    if (
      !quantity.isFinite() ||
      quantity.lte(0) ||
      quantity.gt(1_000_000_000) ||
      quantity.decimalPlaces() > 3
    )
      blockers.push(
        'Quantité non représentable : maximum 1 milliard et 3 décimales, sans arrondi.',
      );
    const metadata = run.sourceMetadata as {
      bomRevisions?: { itemId: string; bomId: string; revisionId: string; contentHash: string }[];
    } | null;
    const ref = metadata?.bomRevisions?.find((r) => r.itemId === proposal.item_id);
    let revision: { id: string; bomId: string; revision: number; contentHash: string } | null =
      null;
    if (proposal.method === 'MAKE') {
      if (!quantity.isInteger())
        blockers.push(
          'Les OF actuels exigent une quantité entière. Aucune quantité fractionnaire ne sera arrondie.',
        );
      const bom =
        ref &&
        (await tx.bomRevision.findFirst({
          where: {
            id: ref.revisionId,
            tenantId,
            bomId: ref.bomId,
            outputItemId: item.item_id,
            contentHash: ref.contentHash,
            outputUnit: item.unit,
            bom: { tenantId, isActive: true },
          },
        }));
      if (!bom) blockers.push('La version de nomenclature capturée est indisponible.');
      else {
        revision = {
          id: bom.id,
          bomId: bom.bomId,
          revision: bom.revision,
          contentHash: bom.contentHash,
        };
        if (
          !coversManufacturingPeriod(
            { validFrom: bom.validFrom?.toISOString(), validUntil: bom.validUntil?.toISOString() },
            proposal.release_date,
            proposal.receipt_date,
          )
        )
          blockers.push('La version publiée ne couvre pas les dates de fabrication proposées.');
      }
    }
    const site = await tx.location.findFirst({
      where: { tenantId, id: run.locationId },
      select: { id: true, name: true, code: true },
    });
    const reviewToken = artifactHash({
      runId,
      sourceHash: run.sourceHash,
      currentHash,
      proposal,
      revision,
      blockers,
    });
    return {
      runId,
      proposal,
      item: { id: item.item_id, sku: item.sku, name: item.name, unit: item.unit },
      site,
      revision,
      existing,
      blockers,
      reviewToken,
      canPrepare: blockers.length === 0,
      notice:
        proposal.method === 'BUY'
          ? 'Demande d’achat interne en brouillon, dans l’unité de stock. Aucun fournisseur contacté, aucun engagement ni arrivage MRP créé.'
          : 'OF en brouillon avec site et version explicites. Configurez sa gamme et ses opérations avant libération. Aucun stock ni arrivage MRP créé.',
    };
  }

  async prepare(
    tenantId: string,
    userId: string,
    runId: string,
    permissions: readonly string[],
    dto: { proposalId: string; reviewToken: string; operationKey: string },
  ) {
    await this.mrp.getRun(tenantId, runId, permissions);
    const fingerprint = artifactHash({
      userId,
      runId,
      proposalId: dto.proposalId,
      reviewToken: dto.reviewToken,
    });
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        // Replay precedes freshness checks: response loss must not create a second document.
        const replay = await tx.mrpPreparation.findFirst({
          where: { tenantId, operationKey: dto.operationKey },
        });
        if (replay) {
          if (replay.fingerprint !== fingerprint)
            throw new ConflictException('Cette clé appartient à une autre confirmation.');
          return { id: replay.id, created: false, orderId: replay.manufacturingOrderId };
        }
        const view = await this.inspect(tx, tenantId, runId, dto.proposalId, permissions);
        if (!view.canPrepare || view.reviewToken !== dto.reviewToken)
          throw new ConflictException(
            view.blockers.join(' ') ||
              'La prévisualisation a changé. Rechargez-la avant de confirmer.',
          );
        const number = await this.sequences.nextNumber(
          tenantId,
          view.proposal.method === 'BUY' ? 'material-requisition' : 'manufacturing-order',
          tx,
        );
        let orderId: string | null = null;
        if (view.proposal.method === 'MAKE') {
          const revision = view.revision!;
          const order = await this.orders.createDraftInTransaction(
            tx,
            tenantId,
            number,
            {
              name: `MRP · ${view.item.name}`,
              productRef: view.item.sku,
              quantity: new Prisma.Decimal(view.proposal.quantity).toNumber(),
              dueDate: view.proposal.receipt_date,
              releaseDate: view.proposal.release_date,
              bomId: revision.bomId,
            },
            { locationId: view.site!.id, bomRevisionId: revision.id },
          );
          orderId = order.id;
        }
        const run = await tx.mrpRun.findFirstOrThrow({ where: { tenantId, id: runId } });
        const saved = await tx.mrpPreparation.create({
          data: {
            tenantId,
            runId,
            proposalId: dto.proposalId,
            operationKey: dto.operationKey,
            fingerprint,
            sourceHash: run.sourceHash,
            proposalSnapshot: json({
              proposal: view.proposal,
              item: view.item,
              revision: view.revision,
            }),
            number,
            method: view.proposal.method,
            locationId: run.locationId,
            itemId: view.item.id,
            quantity: view.proposal.quantity,
            unitSnapshot: view.item.unit,
            releaseDate: new Date(view.proposal.release_date),
            dueDate: new Date(view.proposal.receipt_date),
            manufacturingOrderId: orderId,
            createdById: userId,
          },
        });
        return { id: saved.id, created: true, orderId };
      },
      { timeout: 20000 },
    );
    if (outcome.created) {
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'mrp-preparation',
        entityId: outcome.id,
        after: { runId, proposalId: dto.proposalId, manufacturingOrderId: outcome.orderId },
      });
      if (outcome.orderId)
        await this.audit.log({
          tenantId,
          userId,
          action: AuditAction.CREATE,
          entityType: 'manufacturing-order',
          entityId: outcome.orderId,
          after: { status: 'DRAFT', mrpPreparationId: outcome.id, runId },
        });
    }
    return this.prisma.mrpPreparation.findFirstOrThrow({
      where: { tenantId, id: outcome.id },
      select: projection,
    });
  }

  async cancel(
    tenantId: string,
    userId: string,
    id: string,
    expectedUpdatedAt: string,
    permissions: readonly string[],
  ) {
    const existing = await this.prisma.mrpPreparation.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Préparation introuvable.');
    await this.mrp.getRun(tenantId, existing.runId, permissions);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const current = await tx.mrpPreparation.findFirstOrThrow({ where: { id, tenantId } });
      if (current.method !== 'BUY')
        throw new BadRequestException('Annulez l’OF depuis son workflow Fabrication.');
      if (
        await tx.materialPurchaseOrder.count({
          where: { tenantId, preparationId: id, status: { not: 'CANCELLED' } },
        })
      )
        throw new ConflictException('Annulez d’abord la commande matières liée.');
      if (
        !canTransitionMrpPreparation(
          current.status as MrpPreparationStatus,
          MrpPreparationStatus.CANCELLED,
        ) ||
        current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
      )
        throw new ConflictException('La demande a changé. Rechargez-la.');
      await tx.mrpPreparation.updateMany({
        where: { id, tenantId, status: current.status, updatedAt: current.updatedAt },
        data: {
          status: MrpPreparationStatus.CANCELLED,
          updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'mrp-preparation',
      entityId: id,
      before: { status: 'DRAFT' },
      after: { status: 'CANCELLED' },
    });
    return this.prisma.mrpPreparation.findFirstOrThrow({
      where: { tenantId, id },
      select: projection,
    });
  }
}
