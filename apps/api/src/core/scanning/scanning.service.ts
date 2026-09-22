import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeScan, type ScanKind, type ScanResult } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ScanningService {
  constructor(private readonly prisma: PrismaService) {}
  async resolve(
    tenantId: string,
    kind: ScanKind,
    raw: string,
    locationId?: string,
  ): Promise<ScanResult> {
    let code: string;
    try {
      code = normalizeScan(raw);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    let rows: ScanResult[] = [];
    switch (kind) {
      case 'item':
        rows = (
          await this.prisma.wmsItem.findMany({
            where: { tenantId, isActive: true, OR: [{ barcode: code }, { sku: code }] },
            take: 2,
            select: { id: true, sku: true, name: true, unit: true },
          })
        ).map((r) => ({ ...r, kind, code: r.sku, href: '/wms/items' }));
        break;
      case 'bin':
        rows = (
          await this.prisma.bin.findMany({
            where: { tenantId, isActive: true, code, ...(locationId ? { locationId } : {}) },
            take: 2,
            select: { id: true, code: true, zone: true, locationId: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.code,
          name: r.zone ?? r.code,
          locationId: r.locationId,
          href: '/wms/bins',
        }));
        break;
      case 'load':
        rows = (
          await this.prisma.load.findMany({
            where: { tenantId, loadNumber: code },
            take: 2,
            select: { id: true, loadNumber: true, status: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.loadNumber,
          name: 'Chargement',
          status: r.status,
          href: '/loads/' + r.id,
        }));
        break;
      case 'shipment':
        rows = (
          await this.prisma.shipment.findMany({
            where: { tenantId, shipmentNumber: code },
            take: 2,
            select: { id: true, shipmentNumber: true, status: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.shipmentNumber,
          name: 'Expédition',
          status: r.status,
          href: '/shipments',
        }));
        break;
      case 'manufacturing-order':
        rows = (
          await this.prisma.manufacturingOrder.findMany({
            where: { tenantId, number: code },
            take: 2,
            select: { id: true, number: true, name: true, status: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.number,
          name: r.name,
          status: r.status,
          href: '/manufacturing/orders/' + r.id,
        }));
        break;
      case 'yard-visit':
        rows = (
          await this.prisma.yardVisit.findMany({
            where: { tenantId, visitNumber: code },
            take: 2,
            select: { id: true, visitNumber: true, status: true, locationId: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.visitNumber,
          name: 'Passage de cour',
          status: r.status,
          locationId: r.locationId,
          href: '/yard/gate',
        }));
        break;
      case 'dock-appointment':
        rows = (
          await this.prisma.dockAppointment.findMany({
            where: { tenantId, appointmentNumber: code },
            take: 2,
            select: { id: true, appointmentNumber: true, status: true, locationId: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.appointmentNumber,
          name: 'Rendez-vous',
          status: r.status,
          locationId: r.locationId,
          href: '/yard/appointments',
        }));
        break;
      case 'vehicle':
        rows = (
          await this.prisma.vehicle.findMany({
            where: { tenantId, OR: [{ unitNumber: code }, { vin: code }, { plate: code }] },
            take: 2,
            select: { id: true, unitNumber: true, status: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.unitNumber,
          name: 'Véhicule',
          status: r.status,
          href: '/fleet/vehicles/' + r.id,
        }));
        break;
      case 'trailer':
        rows = (
          await this.prisma.trailer.findMany({
            where: { tenantId, OR: [{ unitNumber: code }, { plate: code }] },
            take: 2,
            select: { id: true, unitNumber: true, status: true },
          })
        ).map((r) => ({
          id: r.id,
          kind,
          code: r.unitNumber,
          name: 'Remorque',
          status: r.status,
          href: '/fleet/trailers/' + r.id,
        }));
    }
    if (!rows.length) throw new NotFoundException('Code inconnu ou indisponible dans ce contexte.');
    if (rows.length > 1)
      throw new ConflictException(
        'Code ambigu : corrigez les doublons ou sélectionnez un entrepôt. Aucun élément sélectionné.',
      );
    return rows[0];
  }
}
