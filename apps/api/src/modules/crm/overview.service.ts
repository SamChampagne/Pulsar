import { Injectable } from '@nestjs/common';
import { CrmActivityType, CrmDealStage, isDealOpen, isDealStale } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface PipelineStageStats {
  stage: string;
  count: number;
  value: number;
}

export interface CrmOverview {
  pipeline: PipelineStageStats[];
  openValue: number;
  wonCount: number;
  lostCount: number;
  winRate: number;
  staleDealCount: number;
  dueFollowupCount: number;
  recentActivities: {
    id: string;
    type: string;
    body: string;
    createdAt: Date;
    dealId: string | null;
    companyId: string | null;
  }[];
}

/**
 * CRM overview stats service (phase CRM v2, Task 1).
 * Computed at read time from existing tables — no rollup store, no migration.
 * All aggregates are tenant-scoped (rule 1).
 * Decimal sums from Prisma are coerced to plain numbers via Number() (rule 36).
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string): Promise<CrmOverview> {
    const now = new Date();

    // All tenant deals — used for pipeline groupBy + open/won/lost counts + stale
    const deals = await this.prisma.crmDeal.findMany({
      where: { tenantId },
      select: {
        id: true,
        stage: true,
        amount: true,
        lastActivityAt: true,
        createdAt: true,
      },
    });

    // Pipeline: per-stage count + sum(amount)
    const stageOrder = [
      CrmDealStage.LEAD,
      CrmDealStage.QUALIFIED,
      CrmDealStage.PROPOSAL,
      CrmDealStage.WON,
      CrmDealStage.LOST,
    ];
    const stageMap = new Map<string, { count: number; value: number }>();
    for (const stage of stageOrder) {
      stageMap.set(stage, { count: 0, value: 0 });
    }
    for (const deal of deals) {
      const bucket = stageMap.get(deal.stage);
      if (bucket) {
        bucket.count += 1;
        bucket.value += deal.amount ? Number(deal.amount) : 0;
      }
    }
    const pipeline: PipelineStageStats[] = stageOrder.map((stage) => ({
      stage,
      count: stageMap.get(stage)!.count,
      value: stageMap.get(stage)!.value,
    }));

    // openValue: sum of amounts for open (non-terminal) deals
    let openValue = 0;
    let wonCount = 0;
    let lostCount = 0;
    let staleDealCount = 0;

    for (const deal of deals) {
      const stage = deal.stage as CrmDealStage;
      if (isDealOpen(stage)) {
        openValue += deal.amount ? Number(deal.amount) : 0;
        if (isDealStale({ stage, lastActivityAt: deal.lastActivityAt, createdAt: deal.createdAt, now })) {
          staleDealCount += 1;
        }
      } else if (stage === CrmDealStage.WON) {
        wonCount += 1;
      } else if (stage === CrmDealStage.LOST) {
        lostCount += 1;
      }
    }

    // winRate = wonCount / (wonCount + lostCount) or 0
    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? wonCount / closedCount : 0;

    // dueFollowupCount: TASK activities with dueAt <= now and doneAt null, tenant-scoped
    const dueFollowupCount = await this.prisma.crmActivity.count({
      where: {
        tenantId,
        type: CrmActivityType.TASK,
        dueAt: { lte: now },
        doneAt: null,
      },
    });

    // recentActivities: latest 8 (id, type, body, createdAt, dealId, companyId)
    const recentActivities = await this.prisma.crmActivity.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        type: true,
        body: true,
        createdAt: true,
        dealId: true,
        companyId: true,
      },
    });

    return {
      pipeline,
      openValue,
      wonCount,
      lostCount,
      winRate,
      staleDealCount,
      dueFollowupCount,
      recentActivities,
    };
  }
}
