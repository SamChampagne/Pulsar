import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@pulsar/database';
import { LoadStatus, MODULE_KEYS } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

const driverLoadSelect = {
  id: true,
  tenantId: true,
  status: true,
  driverId: true,
  updatedAt: true,
  loadNumber: true,
} as const;

export type DriverLoadAccess = Prisma.LoadGetPayload<{ select: typeof driverLoadSelect }>;

/** Public capability access; module/tenant checks cannot rely on JWT guards or a stale cache. */
@Injectable()
export class DriverAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    token: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<DriverLoadAccess> {
    if (!token || token.length > 256) throw new NotFoundException('Unknown driver link');
    // The unique capability is the only permitted bootstrap before the tenant is resolved.
    const load = await tx.load.findUnique({
      where: { driverToken: token },
      select: driverLoadSelect,
    });
    if (!load) throw new NotFoundException('Unknown driver link');
    const tenant = await tx.tenant.findUnique({
      where: { id: load.tenantId },
      select: { status: true },
    });
    if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status))
      throw new ForbiddenException('This shipper is not active');
    const enabled = await tx.tenantModule.findFirst({
      where: {
        tenantId: load.tenantId,
        enabled: true,
        module: { key: MODULE_KEYS.TRANSPORTATION },
      },
      select: { moduleId: true },
    });
    if (!enabled) throw new ForbiddenException('Transportation is not enabled for this shipper');
    return load;
  }

  async lock(token: string, tx: Prisma.TransactionClient): Promise<DriverLoadAccess> {
    if (!token || token.length > 256) throw new NotFoundException('Unknown driver link');
    const initial = await tx.load.findUnique({
      where: { driverToken: token },
      select: { id: true, tenantId: true },
    });
    if (!initial) throw new NotFoundException('Unknown driver link');
    await tx.$queryRaw`SELECT id FROM loads WHERE id = ${initial.id} AND "tenantId" = ${initial.tenantId} FOR UPDATE`;
    const current = await this.resolve(token, tx);
    if (current.id !== initial.id || current.tenantId !== initial.tenantId)
      throw new NotFoundException('Unknown driver link');
    return current;
  }

  assertMutable(status: string): void {
    if (status === LoadStatus.COMPLETED || status === LoadStatus.CANCELLED)
      throw new BadRequestException('This load is closed; no further updates are allowed.');
    if (status !== LoadStatus.DISPATCHED && status !== LoadStatus.IN_TRANSIT)
      throw new BadRequestException('Driver updates require a DISPATCHED or IN_TRANSIT load.');
  }
}
