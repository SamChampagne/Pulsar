import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LoadStatus } from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { buildBolData } from './bol-data';
import { renderBol } from './bol-render';

const BOL_ENTITY_TYPE = 'bill-of-lading';

const ALLOWED_STATUSES: LoadStatus[] = [
  LoadStatus.DISPATCHED,
  LoadStatus.IN_TRANSIT,
  LoadStatus.COMPLETED,
];

@Injectable()
export class BolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditLogsService,
  ) {}

  async generate(tenantId: string, userId: string, loadId: string) {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      include: {
        carrier: { select: { name: true, scacCode: true } },
        driver: { select: { firstName: true, lastName: true } },
        vehicle: { select: { unitNumber: true } },
        trailer: { select: { unitNumber: true } },
        route: {
          include: {
            stops: {
              orderBy: { sequence: 'asc' },
              include: {
                location: {
                  select: { name: true, addressLine1: true, city: true },
                },
              },
            },
          },
        },
        shipments: {
          include: {
            transportOrder: { select: { orderNumber: true, customerReference: true } },
            originLocation: { select: { name: true, addressLine1: true, city: true } },
            destinationLocation: { select: { name: true, addressLine1: true, city: true } },
          },
        },
      },
    });

    if (!load) throw new NotFoundException('Load not found');

    if (!ALLOWED_STATUSES.includes(load.status as LoadStatus)) {
      throw new BadRequestException(
        `BOL can only be generated for loads in DISPATCHED, IN_TRANSIT, or COMPLETED status (current: ${load.status})`,
      );
    }

    const bolNumber = await this.sequences.nextNumber(tenantId, 'bol');
    const data = buildBolData(
      {
        carrier: load.carrier
          ? { name: load.carrier.name, scac: load.carrier.scacCode ?? null }
          : null,
        driver: load.driver ?? null,
        vehicle: load.vehicle ?? null,
        trailer: load.trailer ?? null,
        notes: load.notes ?? null,
        route: load.route
          ? {
              stops: load.route.stops.map((s) => ({
                sequence: s.sequence,
                type: s.type,
                location: s.location,
              })),
            }
          : null,
        shipments: load.shipments.map((s) => ({
          shipmentNumber: s.shipmentNumber,
          weightKg: s.weightKg ?? null,
          palletCount: s.palletCount ?? null,
          originLocation: s.originLocation ?? null,
          destinationLocation: s.destinationLocation ?? null,
          transportOrder: s.transportOrder ?? null,
        })),
      },
      bolNumber,
    );
    const pdf = await renderBol(data);

    const doc = await this.documents.upload(tenantId, {
      entityType: BOL_ENTITY_TYPE,
      entityId: loadId,
      fileName: `${bolNumber}.pdf`,
      mimeType: 'application/pdf',
      body: pdf,
      uploadedById: userId,
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: BOL_ENTITY_TYPE,
      entityId: doc.id,
      after: { bolNumber, loadId, documentId: doc.id },
    });

    return doc;
  }

  listBols(tenantId: string, loadId: string) {
    return this.documents.listForEntity(tenantId, BOL_ENTITY_TYPE, loadId);
  }

  async driverBol(token: string) {
    // Resolve the load by driverToken — server-side only, token is the credential
    const load = await this.prisma.load.findUnique({
      where: { driverToken: token },
      select: { id: true, tenantId: true, driverToken: true },
    });
    if (!load) throw new NotFoundException('Unknown driver link');

    // Find the latest BOL document for this load
    const doc = await this.prisma.document.findFirst({
      where: {
        tenantId: load.tenantId,
        entityType: BOL_ENTITY_TYPE,
        entityId: load.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!doc) throw new NotFoundException('No BOL has been generated for this load');

    // Reuse DocumentsService.download — tenantId and doc.id are server-resolved,
    // the public caller never sees the internal document id.
    return this.documents.download(load.tenantId, doc.id);
  }
}
