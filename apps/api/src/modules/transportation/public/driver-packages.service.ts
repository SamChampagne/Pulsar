import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApiKeysService } from '../../../core/api-keys/api-keys.service';
import {
  DeliveryPackagesService,
  type DriverPackageAuthority,
} from '../delivery-packages/delivery-packages.service';
import { DriverAccessService } from './driver-access.service';
import { driverReference } from './driver-reference';
import { DriverPackageExceptionDto, DriverPackageTransitionDto } from './driver-packages.dto';

@Injectable()
export class DriverPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DriverAccessService,
    private readonly packages: DeliveryPackagesService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async list(token: string) {
    return this.prisma.$transaction(async (tx) => {
      const load = await this.access.lock(token, tx);
      const summary = {
        loadNumber: load.loadNumber,
        status: load.status,
        updatedAt: load.updatedAt,
      };
      if (!['DISPATCHED', 'IN_TRANSIT'].includes(load.status)) return { ...summary, shipments: [] };
      const shipments = await tx.shipment.findMany({
        where: { tenantId: load.tenantId, loadId: load.id },
        orderBy: { shipmentNumber: 'asc' },
        take: 201,
        select: {
          id: true,
          shipmentNumber: true,
          status: true,
          originLocationId: true,
          destinationLocationId: true,
        },
      });
      if (shipments.length > 200)
        throw new BadRequestException('Maximum 200 expéditions par tournée.');
      const ids = shipments.map((s) => s.id);
      const packages = await tx.deliveryPackage.findMany({
        where: { tenantId: load.tenantId, shipmentId: { in: ids } },
        orderBy: { code: 'asc' },
        take: 2001,
        select: {
          id: true,
          shipmentId: true,
          code: true,
          label: true,
          status: true,
          version: true,
          contents: true,
          loadedAt: true,
          deliveredAt: true,
        },
      });
      if (packages.length > 2000) throw new BadRequestException('Maximum 2 000 colis par tournée.');
      const cases = await tx.deliveryException.findMany({
        where: {
          tenantId: load.tenantId,
          loadId: load.id,
          packageId: { in: packages.map((p) => p.id) },
          status: { in: ['OPEN', 'RETRY_PLANNED', 'RETURN_AUTHORIZED'] },
        },
        select: {
          packageId: true,
          status: true,
          retryAt: true,
          returnLocation: { select: { name: true } },
        },
      });
      const locations = await tx.location.findMany({
        where: {
          tenantId: load.tenantId,
          id: { in: shipments.flatMap((s) => [s.originLocationId, s.destinationLocationId]) },
        },
        select: { id: true, name: true },
      });
      const pods = await tx.proofOfDelivery.findMany({
        where: { tenantId: load.tenantId, shipmentId: { in: ids } },
        select: { shipmentId: true },
      });
      return {
        ...summary,
        shipments: shipments.map((s) => ({
          ref: driverReference(token, 'shipment', s.id),
          shipmentNumber: s.shipmentNumber,
          status: s.status,
          originName:
            locations.find((l) => l.id === s.originLocationId)?.name ?? 'Lieu indisponible',
          destinationName:
            locations.find((l) => l.id === s.destinationLocationId)?.name ?? 'Lieu indisponible',
          hasPod: pods.some((p) => p.shipmentId === s.id),
          packages: packages
            .filter((p) => p.shipmentId === s.id)
            .map(({ id, shipmentId: _shipmentId, ...p }) => ({
              ref: driverReference(token, 'package', id),
              ...p,
              incident: (() => {
                const c = cases.find((c) => c.packageId === id);
                return c
                  ? {
                      status: c.status,
                      retryAt: c.retryAt,
                      returnLocationName: c.returnLocation?.name ?? null,
                    }
                  : null;
              })(),
            })),
        })),
      };
    });
  }

  private async command(token: string, ref: string) {
    const load = await this.access.resolve(token);
    if (!/^[A-Za-z0-9_-]{43}$/.test(ref)) throw new NotFoundException('Colis introuvable.');
    const candidates = await this.prisma.deliveryPackage.findMany({
      where: { tenantId: load.tenantId, shipment: { tenantId: load.tenantId, loadId: load.id } },
      select: { id: true },
      take: 2001,
    });
    if (candidates.length > 2000) throw new BadRequestException('Maximum 2 000 colis par tournée.');
    const pkg = candidates.find((p) => driverReference(token, 'package', p.id) === ref);
    if (!pkg) throw new NotFoundException('Colis introuvable.');
    let actorId: string;
    try {
      actorId = await this.apiKeys.ensureServiceUser(load.tenantId);
    } catch (error) {
      // Only recover the first-use unique-account race, never a command mutation.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      actorId = await this.apiKeys.ensureServiceUser(load.tenantId);
    }
    const actor = await this.prisma.user.findFirst({
      where: {
        tenantId: load.tenantId,
        id: actorId,
        status: 'DISABLED',
        email: 'service-account@pulsar.local',
      },
      select: { id: true },
    });
    if (!actor) throw new ForbiddenException('Compte de service indisponible.');
    const authority: DriverPackageAuthority = {
      source: {
        kind: 'DRIVER_LINK',
        linkFingerprint: createHash('sha256').update(token).digest('hex'),
        loadId: load.id,
      },
      authorize: async (tx, replay) => {
        const current = await this.access.lock(token, tx);
        if (
          current.id !== load.id ||
          current.tenantId !== load.tenantId ||
          !(await tx.deliveryPackage.findFirst({
            where: {
              tenantId: load.tenantId,
              id: pkg.id,
              shipment: { tenantId: load.tenantId, loadId: current.id },
            },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Colis introuvable.');
        if (!replay) this.access.assertMutable(current.status);
      },
    };
    return { load, pkg, actorId, authority };
  }

  async transition(token: string, ref: string, dto: DriverPackageTransitionDto) {
    const { load, pkg, actorId, authority } = await this.command(token, ref);
    const result = await this.packages.transition(
      load.tenantId,
      actorId,
      pkg.id,
      { ...dto, expectedLoadId: load.id },
      authority,
    );
    return {
      operationKey: result.operationKey,
      ref,
      code: result.code,
      version: result.version,
      status: result.status,
    };
  }

  async exception(token: string, ref: string, dto: DriverPackageExceptionDto) {
    const { load, pkg, actorId, authority } = await this.command(token, ref);
    const result = await this.packages.driverException(
      load.tenantId,
      actorId,
      pkg.id,
      dto,
      authority,
    );
    return { operationKey: result.operationKey, ref, code: result.code, recorded: true };
  }
}
