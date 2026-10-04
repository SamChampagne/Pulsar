import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type DriverDeliveryDocument } from '@pulsar/database';
import {
  AuditAction,
  type DriverDocumentPreview,
  type DriverDocumentRecord,
  type DriverDocumentSnapshot,
  type PublicDriverDocuments,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { DriverAccessService } from '../public/driver-access.service';
import { driverReference } from '../public/driver-reference';
import { deliveryManifestDigest as digest } from '../delivery-manifests/delivery-manifests.service';
import { IssueDriverDocumentDto } from './driver-documents.dto';
import { renderDriverDocument, validateDriverDocumentPrintable } from './driver-document-render';

type Tx = Prisma.TransactionClient;
const DOCUMENT_TYPE = 'driver-delivery-document-pdf' as const;
const MAX_BYTES = 10 * 1024 * 1024;
const bytesHash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
interface Capture {
  snapshot: DriverDocumentSnapshot;
  scope: Prisma.InputJsonObject;
  status: string;
}

/** Ignores operational progress, but binds every published address/resource/package identity. */
export function driverDocumentScopeHash(snapshot: DriverDocumentSnapshot, scope: unknown): string {
  const { updatedAt: _version, ...load } = snapshot.load;
  return digest({ snapshot: { ...snapshot, load }, scope });
}

@Injectable()
export class DriverDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly documents: DocumentsService,
    private readonly access: DriverAccessService,
  ) {}

  private async capture(tx: Tx, tenantId: string, loadId: string): Promise<Capture> {
    const load = await tx.load.findFirst({
      where: { tenantId, id: loadId },
      select: {
        id: true,
        loadNumber: true,
        updatedAt: true,
        status: true,
        driverId: true,
        carrierId: true,
        vehicleId: true,
        trailerId: true,
      },
    });
    if (!load) throw new NotFoundException('Chargement introuvable.');
    const shipments = await tx.shipment.findMany({
      where: { tenantId, loadId, status: { not: 'CANCELLED' } },
      orderBy: [{ shipmentNumber: 'asc' }, { id: 'asc' }],
      take: 201,
      select: {
        id: true,
        shipmentNumber: true,
        packageTrackingEnabledAt: true,
        originLocationId: true,
        destinationLocationId: true,
      },
    });
    if (shipments.length > 200)
      throw new BadRequestException('Limite de 200 expéditions par document.');
    const packages = await tx.deliveryPackage.findMany({
      where: {
        tenantId,
        shipmentId: { in: shipments.map((s) => s.id) },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 2001,
      select: { id: true, shipmentId: true, code: true, status: true, loadedLoadId: true },
    });
    if (packages.length > 2000)
      throw new BadRequestException('Limite de 2 000 colis par document.');
    if (
      packages.some((p) => ['LOADED', 'DELIVERED'].includes(p.status) && p.loadedLoadId !== loadId)
    )
      throw new ConflictException('Un colis engagé ne correspond plus à cette mission.');
    const route = await tx.route.findFirst({ where: { tenantId, loadId }, select: { id: true } });
    const stops = route
      ? await tx.stop.findMany({
          where: { tenantId, routeId: route.id },
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          take: 501,
          select: { id: true, sequence: true, type: true, locationId: true },
        })
      : [];
    if (stops.length > 500) throw new BadRequestException('Limite de 500 arrêts par document.');
    const locationIds = [
      ...new Set([
        ...shipments.flatMap((s) => [s.originLocationId, s.destinationLocationId]),
        ...stops.map((s) => s.locationId),
      ]),
    ];
    const locations = await tx.location.findMany({
      where: { tenantId, id: { in: locationIds } },
      select: {
        id: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    });
    if (locations.length !== locationIds.length)
      throw new ConflictException(
        'Une adresse opérationnelle est introuvable dans cette entreprise.',
      );
    const address = (id: string) => {
      const l = locations.find((l) => l.id === id)!;
      return {
        name: l.name,
        addressLine1: l.addressLine1,
        addressLine2: l.addressLine2,
        city: l.city,
        province: l.state,
        postalCode: l.postalCode,
        country: l.country,
      };
    };
    const driver = load.driverId
      ? await tx.driver.findFirst({
          where: { tenantId, id: load.driverId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const carrier = load.carrierId
      ? await tx.carrier.findFirst({
          where: { tenantId, id: load.carrierId },
          select: { name: true },
        })
      : null;
    const vehicle = load.vehicleId
      ? await tx.vehicle.findFirst({
          where: { tenantId, id: load.vehicleId },
          select: { unitNumber: true },
        })
      : null;
    const trailer = load.trailerId
      ? await tx.trailer.findFirst({
          where: { tenantId, id: load.trailerId },
          select: { unitNumber: true },
        })
      : null;
    if (
      (load.driverId && !driver) ||
      (load.carrierId && !carrier) ||
      (load.vehicleId && !vehicle) ||
      (load.trailerId && !trailer)
    )
      throw new ConflictException('Une ressource affectée est absente de cette entreprise.');
    const snapshot: DriverDocumentSnapshot = {
      schemaVersion: 1,
      load: {
        loadNumber: load.loadNumber,
        updatedAt: load.updatedAt.toISOString(),
        driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() : null,
        carrierName: carrier?.name ?? null,
        vehicleNumber: vehicle?.unitNumber ?? null,
        trailerNumber: trailer?.unitNumber ?? null,
      },
      stops: stops.map((s) => ({
        sequence: s.sequence,
        type: s.type,
        location: address(s.locationId),
      })),
      shipments: shipments.map((s) => ({
        shipmentNumber: s.shipmentNumber,
        trackingEnabled: !!s.packageTrackingEnabledAt,
        origin: address(s.originLocationId),
        destination: address(s.destinationLocationId),
        packageCodes: packages.filter((p) => p.shipmentId === s.id).map((p) => p.code),
      })),
    };
    // Never return this identity binding to the capability caller or print it in the PDF.
    const scope: Prisma.InputJsonObject = {
      loadId,
      driverId: load.driverId,
      carrierId: load.carrierId,
      vehicleId: load.vehicleId,
      trailerId: load.trailerId,
      routeId: route?.id ?? null,
      stops: stops.map((s) => ({ id: s.id, locationId: s.locationId })),
      shipments: shipments.map((s) => ({
        id: s.id,
        originLocationId: s.originLocationId,
        destinationLocationId: s.destinationLocationId,
        packageIds: packages.filter((p) => p.shipmentId === s.id).map((p) => p.id),
      })),
    };
    if (Buffer.byteLength(JSON.stringify({ snapshot, scope })) > 5 * 1024 * 1024)
      throw new BadRequestException('Document supérieur à 5 Mio.');
    return { snapshot, scope, status: load.status };
  }

  private async assess(
    tx: Tx,
    tenantId: string,
    loadId: string,
    capture: Capture,
  ): Promise<DriverDocumentPreview> {
    const { snapshot, scope, status } = capture;
    const blockers: string[] = [];
    if (['COMPLETED', 'CANCELLED'].includes(status))
      blockers.push('Chargement clos : aucune nouvelle publication chauffeur.');
    if (!scope.driverId) blockers.push('Affectez un chauffeur avant la publication.');
    if (!snapshot.shipments.length) blockers.push('Ajoutez au moins une expédition active.');
    if (snapshot.shipments.some((s) => s.trackingEnabled && !s.packageCodes.length))
      blockers.push('Chaque expédition suivie exige au moins un colis hors annulation et retour.');
    const last = await tx.driverDeliveryDocument.findFirst({
      where: { tenantId, loadId },
      orderBy: { revision: 'desc' },
      select: { scopeHash: true },
    });
    if (last?.scopeHash === driverDocumentScopeHash(snapshot, scope))
      blockers.push('Ce contenu est déjà publié. Réimprimez la dernière édition.');
    try {
      validateDriverDocumentPrintable(snapshot);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : 'Contenu non imprimable.');
    }
    return {
      snapshot,
      sourceHash: digest({ snapshot, scope }),
      canIssue: !blockers.length,
      blockers,
    };
  }

  preview(tenantId: string, loadId: string) {
    return this.prisma.$transaction(
      async (tx) => this.assess(tx, tenantId, loadId, await this.capture(tx, tenantId, loadId)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }

  private summary(row: DriverDeliveryDocument) {
    return {
      id: row.id,
      number: row.number,
      revision: row.revision,
      issuedAt: row.issuedAt.toISOString(),
      reason: row.reason,
      sourceHash: row.sourceHash,
      snapshotHash: row.snapshotHash,
      ready: !!row.documentId && !!row.fileHash,
    };
  }
  private record(row: DriverDeliveryDocument): DriverDocumentRecord {
    const snapshot = row.snapshot as unknown as DriverDocumentSnapshot;
    if (
      !snapshot ||
      snapshot.schemaVersion !== 1 ||
      digest({ snapshot, scope: row.scope }) !== row.sourceHash ||
      driverDocumentScopeHash(snapshot, row.scope) !== row.scopeHash ||
      digest({
        number: row.number,
        revision: row.revision,
        issuedAt: row.issuedAt.toISOString(),
        reason: row.reason,
        sourceHash: row.sourceHash,
        snapshot,
        scope: row.scope,
      }) !== row.snapshotHash
    )
      throw new ConflictException('L’intégrité du document chauffeur ne peut pas être vérifiée.');
    return { ...this.summary(row), snapshot };
  }
  private async find(tenantId: string, loadId: string, id: string, tx: Tx = this.prisma) {
    const row = await tx.driverDeliveryDocument.findFirst({ where: { tenantId, loadId, id } });
    if (!row) throw new NotFoundException('Document chauffeur introuvable.');
    return row;
  }
  async detail(tenantId: string, loadId: string, id: string) {
    return this.record(await this.find(tenantId, loadId, id));
  }
  async list(tenantId: string, loadId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.load.findFirst({ where: { tenantId, id: loadId }, select: { id: true } })))
          throw new NotFoundException('Chargement introuvable.');
        const where = { tenantId, loadId };
        const [rows, total] = await Promise.all([
          tx.driverDeliveryDocument.findMany({ where, orderBy: { revision: 'desc' }, skip, take }),
          tx.driverDeliveryDocument.count({ where }),
        ]);
        return paginated(
          rows.map((row) => this.summary(row)),
          total,
          page,
          pageSize,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async issue(tenantId: string, actorId: string, loadId: string, dto: IssueDriverDocumentDto) {
    if (dto.confirmDriverPublication !== true)
      throw new BadRequestException('Confirmez explicitement la publication au chauffeur.');
    const reason = dto.reason.trim(),
      operationKey = dto.operationKey.toLowerCase();
    if (!reason || reason.length > 300 || /[\u0000-\u001f\u007f]/u.test(reason))
      throw new BadRequestException('Motif requis, 300 caractères maximum, sans contrôle.');
    const fingerprint = digest({
      actorId,
      loadId,
      sourceHash: dto.sourceHash,
      expectedLoadUpdatedAt: dto.expectedLoadUpdatedAt,
      reason,
      confirmDriverPublication: true,
    });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (
            !(await tx.user.findFirst({
              where: {
                tenantId,
                id: actorId,
                status: 'ACTIVE',
                agentServiceFor: { none: {} },
                NOT: { email: 'service-account@pulsar.local' },
              },
              select: { id: true },
            }))
          )
            throw new ForbiddenException('Publication réservée à un utilisateur actif.');
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`driver-document:${tenantId}:${operationKey}`}, 0))`;
          const replay = await tx.driverDeliveryDocument.findFirst({
            where: { tenantId, operationKey },
          });
          if (replay) {
            if (
              replay.actorId !== actorId ||
              replay.loadId !== loadId ||
              replay.fingerprint !== fingerprint
            )
              throw new ConflictException('Cette clé appartient à une autre demande.');
            return this.record(replay);
          }
          await tx.$queryRaw`SELECT id FROM loads WHERE id = ${loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
          const capture = await this.capture(tx, tenantId, loadId),
            preview = await this.assess(tx, tenantId, loadId, capture);
          if (
            preview.snapshot.load.updatedAt !== dto.expectedLoadUpdatedAt ||
            preview.sourceHash !== dto.sourceHash
          )
            throw new ConflictException(
              'Le dossier a changé. Relisez un nouvel aperçu avant publication.',
            );
          if (!preview.canIssue) throw new ConflictException(preview.blockers.join(' '));
          const last = await tx.driverDeliveryDocument.findFirst({
            where: { tenantId, loadId },
            orderBy: { revision: 'desc' },
            select: { revision: true },
          });
          const number = await this.sequences.nextNumber(tenantId, 'driver-delivery-document', tx),
            revision = (last?.revision ?? 0) + 1,
            issuedAt = new Date();
          const snapshotHash = digest({
            number,
            revision,
            issuedAt: issuedAt.toISOString(),
            reason,
            sourceHash: preview.sourceHash,
            snapshot: capture.snapshot,
            scope: capture.scope,
          });
          const row = await tx.driverDeliveryDocument.create({
            data: {
              tenantId,
              loadId,
              actorId,
              operationKey,
              fingerprint,
              number,
              revision,
              issuedAt,
              reason,
              sourceHash: preview.sourceHash,
              snapshotHash,
              scopeHash: driverDocumentScopeHash(capture.snapshot, capture.scope),
              snapshot: capture.snapshot as unknown as Prisma.InputJsonValue,
              scope: capture.scope,
            },
          });
          await this.audit.log(
            {
              tenantId,
              userId: actorId,
              action: AuditAction.CREATE,
              entityType: 'driver-delivery-document',
              entityId: row.id,
              after: {
                number,
                revision,
                loadId,
                operationKey,
                sourceHash: row.sourceHash,
                snapshotHash,
                reason,
                publishedForDriver: true,
              },
            },
            tx,
          );
          return this.record(row);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (['P2034', 'P2002'].includes(error.code) ||
          (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))
      )
        throw new ConflictException(
          'Publication concurrente. Inspectez puis reprenez exactement la même demande.',
        );
      throw error;
    }
  }

  async prepareFile(tenantId: string, actorId: string, loadId: string, id: string) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`driver-document-file:${tenantId}:${id}`}, 0))`;
        const row = await this.find(tenantId, loadId, id, tx),
          record = this.record(row);
        if (row.documentId) return;
        const body = await renderDriverDocument(record);
        if (!body.length || body.length > MAX_BYTES)
          throw new BadRequestException('PDF supérieur à 10 Mio.');
        const fileHash = bytesHash(body);
        const document = await this.documents.upload(
          tenantId,
          {
            entityType: DOCUMENT_TYPE,
            entityId: id,
            fileName: `${row.number}-r${row.revision}.pdf`,
            mimeType: 'application/pdf',
            body,
            uploadedById: actorId,
          },
          DOCUMENT_TYPE,
          tx,
        );
        const bound = await tx.driverDeliveryDocument.updateMany({
          where: { tenantId, loadId, id, documentId: null },
          data: { documentId: document.id, fileHash },
        });
        if (bound.count !== 1)
          throw new ConflictException('Le fichier a été lié concurremment. Relisez cette édition.');
        await this.audit.log(
          {
            tenantId,
            userId: actorId,
            action: AuditAction.CREATE,
            entityType: 'driver-delivery-document-file',
            entityId: id,
            after: { documentId: document.id, fileHash, snapshotHash: row.snapshotHash },
          },
          tx,
        );
      },
      { timeout: 60000 },
    );
    await this.download(tenantId, loadId, id);
    return { ready: true };
  }

  async download(tenantId: string, loadId: string, id: string) {
    const row = await this.find(tenantId, loadId, id);
    this.record(row);
    if (!row.documentId || !row.fileHash)
      throw new ConflictException('Le PDF doit être préparé par l’exploitation.');
    const metadata = await this.prisma.document.findFirst({
      where: {
        tenantId,
        id: row.documentId,
        entityType: DOCUMENT_TYPE,
        entityId: id,
        mimeType: 'application/pdf',
      },
      select: { sizeBytes: true },
    });
    if (!metadata || metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_BYTES)
      throw new ConflictException('Document canonique invalide.');
    const file = await this.documents.download(tenantId, row.documentId, DOCUMENT_TYPE),
      chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BYTES) {
        file.stream.destroy();
        throw new ConflictException('Document canonique trop volumineux.');
      }
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    if (body.length !== metadata.sizeBytes || bytesHash(body) !== row.fileHash)
      throw new ConflictException('L’intégrité du PDF ne peut pas être vérifiée.');
    return { body, fileName: `${row.number}-r${row.revision}.pdf`.replace(/[^\w.-]/g, '_') };
  }

  /** One current edition only. A historical safe PDF may still describe a now-detached shipment. */
  private async authorizePublic(token: string, ref?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const load = await this.access.lock(token, tx);
        if (!['DISPATCHED', 'IN_TRANSIT'].includes(load.status))
          throw new ConflictException(
            'Documents chauffeur accessibles uniquement pendant la mission active.',
          );
        const row = await tx.driverDeliveryDocument.findFirst({
          where: { tenantId: load.tenantId, loadId: load.id },
          orderBy: { revision: 'desc' },
        });
        if (!row)
          return { row: null, message: 'Aucun document de tournée publié par l’exploitation.' };
        if (ref && driverReference(token, 'document', row.id) !== ref)
          throw new NotFoundException('Document absent de cette mission.');
        this.record(row);
        const current = await this.capture(tx, load.tenantId, load.id);
        if (driverDocumentScopeHash(current.snapshot, current.scope) !== row.scopeHash)
          return {
            row: null,
            message: 'La mission a changé. Demandez une nouvelle publication à l’exploitation.',
          };
        return { row, message: null };
      },
      { timeout: 15000 },
    );
  }

  async publicList(token: string): Promise<PublicDriverDocuments> {
    const { row, message } = await this.authorizePublic(token);
    return {
      documents: row
        ? [
            {
              ref: driverReference(token, 'document', row.id),
              number: row.number,
              revision: row.revision,
              issuedAt: row.issuedAt.toISOString(),
              ready: !!row.documentId && !!row.fileHash,
            },
          ]
        : [],
      message,
    };
  }
  async publicDownload(token: string, ref: string) {
    const before = await this.authorizePublic(token, ref);
    if (!before.row)
      throw new ConflictException(before.message ?? 'Aucun document chauffeur disponible.');
    const file = await this.download(before.row.tenantId, before.row.loadId, before.row.id);
    // Storage I/O is outside the transaction (pool=1). Revoke/close/reassign during I/O must win.
    const after = await this.authorizePublic(token, ref);
    if (!after.row || after.row.id !== before.row.id)
      throw new ConflictException('La publication chauffeur a changé pendant le téléchargement.');
    return file;
  }
}
