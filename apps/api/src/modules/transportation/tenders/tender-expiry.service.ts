import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoadStatus, TenderStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhooksService } from '../../../core/integrations/webhooks.service';
import { TendersService } from './tenders.service';

/**
 * Expires overdue PENDING tenders and advances automatic chains.
 * Complements the lazy expiry done on public reads (a carrier who never opens
 * the link would otherwise block the load forever).
 */
@Injectable()
export class TenderExpiryService {
  private readonly logger = new Logger(TenderExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenders: TendersService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireOverdueTenders(): Promise<void> {
    const overdue = await this.prisma.tender.findMany({
      where: { status: TenderStatus.PENDING, expiresAt: { lt: new Date() } },
      include: { load: { select: { id: true, loadNumber: true } } },
    });
    if (overdue.length === 0) return;
    this.logger.log(`Expiring ${overdue.length} overdue tender(s)`);

    for (const tender of overdue) {
      await this.prisma.$transaction([
        this.prisma.tender.update({
          where: { id: tender.id },
          data: { status: TenderStatus.EXPIRED, respondedAt: new Date() },
        }),
        this.prisma.load.updateMany({
          where: { id: tender.loadId, status: LoadStatus.TENDERED },
          data: { status: LoadStatus.PLANNED },
        }),
      ]);
      await this.webhooks.emit(tender.tenantId, 'tender.expired', {
        loadId: tender.loadId,
        loadNumber: tender.load.loadNumber,
        tenderId: tender.id,
        carrierId: tender.carrierId,
      });
      await this.tenders.advanceChain(tender.id);
    }
  }
}
