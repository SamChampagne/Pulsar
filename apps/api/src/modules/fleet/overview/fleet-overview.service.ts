import { Injectable } from '@nestjs/common';
import { MaintenanceOrderStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ComplianceService } from '../compliance/compliance.service';

/**
 * Read-only dashboard rollup for the fleet module: open work orders, work
 * orders coming due within 7 days, and compliance docs expiring/expired within
 * the 30-day window. The compliance window is fetched ONCE then filtered twice
 * (DRY). Tenant-scoped (rule 1); status is computed on read (rule 32).
 */
@Injectable()
export class FleetOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
  ) {}

  async overview(tenantId: string, now = Date.now()) {
    const activeStatuses = [MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS];

    const openWorkOrders = await this.prisma.maintenanceOrder.count({
      where: { tenantId, status: { in: activeStatuses } },
    });

    const maintenanceDue = await this.prisma.maintenanceOrder.findMany({
      where: {
        tenantId,
        status: { in: activeStatuses },
        dueDate: { lte: new Date(now + 7 * 86_400_000) },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const expiringWindow = await this.compliance.expiring(tenantId, 30, now);
    const complianceExpiring = expiringWindow.filter((d) => d.status === 'EXPIRING');
    const complianceExpired = expiringWindow.filter((d) => d.status === 'EXPIRED');

    return { openWorkOrders, maintenanceDue, complianceExpiring, complianceExpired };
  }
}
