import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Tenant-scoped entities that can be referenced by id in write payloads. */
export type OwnedEntity =
  | 'customer'
  | 'customerInvoice'
  | 'invoice'
  | 'payment'
  | 'bankAccount'
  | 'location'
  | 'yardSpot'
  | 'dockAppointment'
  | 'carrier'
  | 'driver'
  | 'vehicle'
  | 'trailer'
  | 'rate'
  | 'lane'
  | 'accessorial'
  | 'fuelSurchargeTable'
  | 'transportOrder'
  | 'shipment'
  | 'load'
  | 'stop'
  | 'role'
  | 'user'
  | 'workingCalendar'
  | 'workCenter'
  | 'routing'
  | 'bom'
  | 'manufacturingOrder';

/**
 * Write-path referential guard: every foreign key accepted from a request body
 * must point to a row of the caller's tenant. Read paths are already tenant-filtered;
 * this closes the cross-tenant linking hole on creates/updates.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOwned(entity: OwnedEntity, id: string, tenantId: string): Promise<void> {
    // All owned entities share the { id, tenantId } shape; the delegate lookup is dynamic.
    const delegate = this.prisma[entity] as unknown as {
      findFirst(args: {
        where: { id: string; tenantId: string };
        select: { id: true };
      }): Promise<unknown>;
    };
    const row = await delegate.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!row) {
      throw new BadRequestException(`Unknown ${entity} "${id}"`);
    }
  }

  /** Convenience for optional/nullable foreign keys. */
  async assertOwnedIfSet(
    entity: OwnedEntity,
    id: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    if (id !== null && id !== undefined) {
      await this.assertOwned(entity, id, tenantId);
    }
  }
}
