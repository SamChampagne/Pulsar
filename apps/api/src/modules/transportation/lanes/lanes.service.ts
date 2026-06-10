import { BadRequestException, Injectable } from '@nestjs/common';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';

const laneInclude = {
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  carrier: { select: { id: true, code: true, name: true, email: true } },
} as const;

@Injectable()
export class LanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /** All lanes of the tenant, grouped client-side; or one lane when both ids given. */
  list(tenantId: string, originLocationId?: string, destinationLocationId?: string) {
    return this.prisma.laneCarrierPreference.findMany({
      where: {
        tenantId,
        ...(originLocationId ? { originLocationId } : {}),
        ...(destinationLocationId ? { destinationLocationId } : {}),
      },
      orderBy: [{ originLocationId: 'asc' }, { destinationLocationId: 'asc' }, { rank: 'asc' }],
      include: laneInclude,
    });
  }

  /** Replaces the ordered carrier list of a lane (idempotent PUT semantics). */
  async setLane(
    tenantId: string,
    originLocationId: string,
    destinationLocationId: string,
    carrierIds: string[],
  ) {
    if (new Set(carrierIds).size !== carrierIds.length) {
      throw new BadRequestException('Duplicate carriers in the preference list');
    }
    await Promise.all([
      this.ownership.assertOwned('location', originLocationId, tenantId),
      this.ownership.assertOwned('location', destinationLocationId, tenantId),
      ...carrierIds.map((id) => this.ownership.assertOwned('carrier', id, tenantId)),
    ]);

    await this.prisma.$transaction([
      this.prisma.laneCarrierPreference.deleteMany({
        where: { tenantId, originLocationId, destinationLocationId },
      }),
      this.prisma.laneCarrierPreference.createMany({
        data: carrierIds.map((carrierId, index) => ({
          tenantId,
          originLocationId,
          destinationLocationId,
          carrierId,
          rank: index + 1,
        })),
      }),
    ]);
    return this.list(tenantId, originLocationId, destinationLocationId);
  }

  /** Ordered carrier ids for a lane — used by auto-tendering. */
  async orderedCarrierIds(
    tenantId: string,
    originLocationId: string,
    destinationLocationId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.laneCarrierPreference.findMany({
      where: { tenantId, originLocationId, destinationLocationId },
      orderBy: { rank: 'asc' },
      select: { carrierId: true },
    });
    return rows.map((r) => r.carrierId);
  }
}
