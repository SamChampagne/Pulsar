import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type DeliveryManifest } from '@pulsar/database';
import {
  AuditAction,
  DeliveryPackageStatus,
  validateDeliveryPackageContents,
  type DeliveryManifestSnapshot,
  type DeliveryManifestRecord,
  type DeliveryManifestFileKind,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../../core/documents/documents.service';
import { paginationArgs, paginated } from '../../../common/pagination';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { IssueDeliveryManifestDto } from './delivery-manifests.dto';
import { renderDeliveryManifest, validateDeliveryManifestPrintable } from './manifest-render';

type Tx = Prisma.TransactionClient;
// PostgreSQL JSONB sorts object keys. Hash semantic JSON in a stable order, preserving arrays.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const deliveryManifestDigest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const digest = deliveryManifestDigest;
const bytesDigest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const docType = (kind: DeliveryManifestFileKind) =>
  kind === 'manifest' ? ('delivery-manifest-pdf' as const) : ('delivery-labels-pdf' as const);
const addressSelect = {
  id: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
};

@Injectable()
export class DeliveryManifestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Closed, tenant-checked projection. Never include tokens, notes, costs or unrelated stops. */
  private async capture(
    tx: Tx,
    tenantId: string,
    loadId: string,
  ): Promise<DeliveryManifestSnapshot> {
    const load = await tx.load.findFirst({
      where: { tenantId, id: loadId },
      select: {
        id: true,
        loadNumber: true,
        status: true,
        updatedAt: true,
        carrierId: true,
        driverId: true,
        vehicleId: true,
        trailerId: true,
      },
    });
    if (!load) throw new NotFoundException('Chargement introuvable.');
    const shipments = await tx.shipment.findMany({
      where: { tenantId, loadId },
      orderBy: [{ shipmentNumber: 'asc' }, { id: 'asc' }],
      take: 201,
      select: {
        id: true,
        shipmentNumber: true,
        status: true,
        packageTrackingEnabledAt: true,
        originLocationId: true,
        destinationLocationId: true,
      },
    });
    if (shipments.length > 200)
      throw new BadRequestException('Un manifeste accepte au plus 200 expéditions.');
    const packages = await tx.deliveryPackage.findMany({
      where: { tenantId, shipmentId: { in: shipments.map((s) => s.id) } },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 2001,
    });
    if (packages.length > 2000)
      throw new BadRequestException('Un manifeste accepte au plus 2 000 colis.');
    const route = await tx.route.findFirst({ where: { tenantId, loadId }, select: { id: true } });
    const stops = route
      ? await tx.stop.findMany({
          where: { tenantId, routeId: route.id },
          orderBy: { sequence: 'asc' },
          take: 501,
          select: { sequence: true, type: true, locationId: true },
        })
      : [];
    if (stops.length > 500)
      throw new BadRequestException('Un manifeste accepte au plus 500 arrêts.');
    const ids = [
      ...new Set([
        ...shipments.flatMap((s) => [s.originLocationId, s.destinationLocationId]),
        ...stops.map((s) => s.locationId),
      ]),
    ];
    const locations = await tx.location.findMany({
      where: { tenantId, id: { in: ids } },
      select: addressSelect,
    });
    if (locations.length !== ids.length)
      throw new ConflictException('Une adresse est absente ou hors de cette entreprise.');
    const address = (id: string) => {
      const value = locations.find((l) => l.id === id)!;
      return {
        name: value.name,
        addressLine1: value.addressLine1,
        addressLine2: value.addressLine2,
        city: value.city,
        province: value.state,
        postalCode: value.postalCode,
        country: value.country,
      };
    };
    const carrier = load.carrierId
      ? await tx.carrier.findFirst({
          where: { tenantId, id: load.carrierId },
          select: { name: true },
        })
      : null;
    const driver = load.driverId
      ? await tx.driver.findFirst({
          where: { tenantId, id: load.driverId },
          select: { firstName: true, lastName: true },
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
      (load.carrierId && !carrier) ||
      (load.driverId && !driver) ||
      (load.vehicleId && !vehicle) ||
      (load.trailerId && !trailer)
    )
      throw new ConflictException(
        'Une ressource du chargement est absente ou hors de cette entreprise.',
      );
    if (
      packages.some((p) => ['LOADED', 'DELIVERED', 'RETURNED'].includes(p.status) && p.loadedLoadId !== loadId)
    )
      throw new ConflictException(
        'Le contexte physique d’un colis ne correspond pas au chargement.',
      );
    try {
      const snapshot: DeliveryManifestSnapshot = {
        schemaVersion: 1,
        load: {
          id: load.id,
          loadNumber: load.loadNumber,
          status: load.status,
          updatedAt: load.updatedAt.toISOString(),
          carrierName: carrier?.name ?? null,
          driverName: driver ? `${driver.firstName} ${driver.lastName}`.trim() : null,
          vehicleNumber: vehicle?.unitNumber ?? null,
          trailerNumber: trailer?.unitNumber ?? null,
        },
        stops: stops.map((s) => ({
          sequence: s.sequence,
          type: s.type,
          location: address(s.locationId),
        })),
        shipments: shipments.map((s) => ({
          id: s.id,
          shipmentNumber: s.shipmentNumber,
          status: s.status,
          trackingEnabled: !!s.packageTrackingEnabledAt,
          origin: address(s.originLocationId),
          destination: address(s.destinationLocationId),
          packages: packages
            .filter((p) => p.shipmentId === s.id)
            .map((p) => ({
              id: p.id,
              code: p.code,
              label: p.label,
              status: p.status as DeliveryPackageStatus,
              version: p.version,
              contents: validateDeliveryPackageContents(p.contents),
              loadedAt: p.loadedAt?.toISOString() ?? null,
              deliveredAt: p.deliveredAt?.toISOString() ?? null,
            })),
        })),
      };
      if (
        snapshot.shipments.flatMap((s) => s.packages).reduce((n, p) => n + p.contents.length, 0) >
        5000
      )
        throw new Error('Un manifeste accepte au plus 5 000 lignes de contenu.');
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 5 * 1024 * 1024)
        throw new Error('Le manifeste dépasse la limite de 5 Mio de données.');
      return snapshot;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Déclaration invalide.',
      );
    }
  }

  private async assess(tx: Tx, tenantId: string, snapshot: DeliveryManifestSnapshot) {
    const sourceHash = digest(snapshot),
      blockers: string[] = [];
    if (['COMPLETED', 'CANCELLED'].includes(snapshot.load.status))
      blockers.push('Le chargement est clos : seules les éditions déjà figées sont réimprimables.');
    if (!snapshot.shipments.length) blockers.push('Ajoutez au moins une expédition au chargement.');
    if (
      snapshot.shipments.some(
        (s) => s.trackingEnabled && !s.packages.some((p) => p.status !== 'CANCELLED'),
      )
    )
      blockers.push('Déclarez au moins un colis actif pour chaque expédition suivie.');
    const latest = await tx.deliveryManifest.findFirst({
      where: { tenantId, loadId: snapshot.load.id },
      orderBy: { revision: 'desc' },
      select: { sourceHash: true },
    });
    if (latest?.sourceHash === sourceHash)
      blockers.push('Ce contenu est déjà figé. Réimprimez l’édition existante.');
    try {
      validateDeliveryManifestPrintable(snapshot);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : 'Contenu non imprimable.');
    }
    return { sourceHash, snapshot, canIssue: !blockers.length, blockers };
  }

  preview(tenantId: string, loadId: string) {
    return this.prisma.$transaction(
      async (tx) => this.assess(tx, tenantId, await this.capture(tx, tenantId, loadId)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }

  private summary(row: DeliveryManifest) {
    return {
      id: row.id,
      number: row.number,
      revision: row.revision,
      issuedAt: row.issuedAt.toISOString(),
      reason: row.reason,
      snapshotHash: row.snapshotHash,
      sourceHash: row.sourceHash,
    };
  }

  private record(row: DeliveryManifest): DeliveryManifestRecord {
    const record = {
      ...this.summary(row),
      snapshot: row.snapshot as unknown as DeliveryManifestSnapshot,
    };
    // Prisma JSONB does not preserve property order: canonicalize before hashing (see digest below).
    if (
      !record.snapshot ||
      record.snapshot.schemaVersion !== 1 ||
      digest(record.snapshot) !== record.sourceHash ||
      digest({
        number: record.number,
        revision: record.revision,
        issuedAt: record.issuedAt,
        reason: record.reason,
        snapshot: record.snapshot,
      }) !== record.snapshotHash
    )
      throw new ConflictException(
        'L’intégrité du manifeste ne peut pas être vérifiée. Aucun document reconstruit.',
      );
    return record;
  }

  private async find(tenantId: string, loadId: string, id: string, tx: Tx = this.prisma) {
    const row = await tx.deliveryManifest.findFirst({ where: { tenantId, loadId, id } });
    if (!row) throw new NotFoundException('Manifeste introuvable dans ce chargement.');
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
        const [items, total] = await Promise.all([
          tx.deliveryManifest.findMany({
            where,
            orderBy: { revision: 'desc' },
            skip,
            take,
            select: {
              id: true,
              number: true,
              revision: true,
              issuedAt: true,
              reason: true,
              snapshotHash: true,
              sourceHash: true,
            },
          }),
          tx.deliveryManifest.count({ where }),
        ]);
        return paginated(
          items.map((r) => ({ ...r, issuedAt: r.issuedAt.toISOString() })),
          total,
          page,
          pageSize,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async issue(tenantId: string, actorId: string, loadId: string, dto: IssueDeliveryManifestDto) {
    const operationKey = dto.operationKey.toLowerCase(),
      reason = dto.reason.trim();
    if (!reason || /[^\x20-\x7e\xa0-\xffŒœŸ€‘’“”–—]/u.test(reason))
      throw new BadRequestException(
        'Précisez un motif en caractères latins occidentaux, sans caractères de contrôle.',
      );
    const fingerprint = digest({
      actorId,
      loadId,
      sourceHash: dto.sourceHash,
      expectedLoadUpdatedAt: dto.expectedLoadUpdatedAt,
      reason,
    });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-manifest:${tenantId}:${operationKey}`}, 0))`;
          const replay = await tx.deliveryManifest.findFirst({ where: { tenantId, operationKey } });
          if (replay) {
            if (
              replay.actorId !== actorId ||
              replay.fingerprint !== fingerprint ||
              replay.loadId !== loadId
            )
              throw new ConflictException('Cette clé a déjà servi pour une autre demande.');
            return this.record(replay);
          }
          await tx.$queryRaw`SELECT id FROM loads WHERE id = ${loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
          const snapshot = await this.capture(tx, tenantId, loadId);
          const preview = await this.assess(tx, tenantId, snapshot);
          if (
            snapshot.load.updatedAt !== dto.expectedLoadUpdatedAt ||
            preview.sourceHash !== dto.sourceHash
          )
            throw new ConflictException(
              'Le contenu a changé. Rouvrez l’aperçu avant une nouvelle édition.',
            );
          if (!preview.canIssue) throw new ConflictException(preview.blockers.join(' '));
          const last = await tx.deliveryManifest.findFirst({
            where: { tenantId, loadId },
            orderBy: { revision: 'desc' },
            select: { revision: true },
          });
          const number = await this.sequences.nextNumber(tenantId, 'delivery-manifest', tx),
            revision = (last?.revision ?? 0) + 1,
            issuedAt = new Date();
          const snapshotHash = digest({
            number,
            revision,
            issuedAt: issuedAt.toISOString(),
            reason,
            snapshot,
          });
          try {
            validateDeliveryManifestPrintable({
              id: 'pending',
              number,
              revision,
              issuedAt: issuedAt.toISOString(),
              reason,
              sourceHash: preview.sourceHash,
              snapshotHash,
              snapshot,
            });
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error ? error.message : 'Document non imprimable.',
            );
          }
          const manifest = await tx.deliveryManifest.create({
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
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
          await this.audit.log(
            {
              tenantId,
              userId: actorId,
              action: AuditAction.CREATE,
              entityType: 'delivery-manifest',
              entityId: manifest.id,
              after: {
                number,
                revision,
                loadId,
                operationKey,
                sourceHash: preview.sourceHash,
                snapshotHash,
                reason,
              },
            },
            tx,
          );
          return this.record(manifest);
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
          'Édition concurrente. Inspectez l’historique puis reprenez exactement la même demande.',
        );
      throw error;
    }
  }

  private kind(value: string): DeliveryManifestFileKind {
    if (value !== 'manifest' && value !== 'labels')
      throw new BadRequestException('Format de document inconnu.');
    return value;
  }

  async prepareFile(tenantId: string, actorId: string, loadId: string, id: string, value: string) {
    const kind = this.kind(value);
    // A separate lock: rendering never holds the operational Load lock.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-manifest-file:${tenantId}:${id}`}, 0))`;
        const row = await this.find(tenantId, loadId, id, tx),
          record = this.record(row);
        if (kind === 'manifest' ? row.manifestDocumentId : row.labelsDocumentId) {
          return { ready: true };
        }
        let body: Buffer;
        try {
          body = await renderDeliveryManifest(record, kind);
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : 'Document non imprimable.',
          );
        }
        if (!body.length || body.length > MAX_FILE_BYTES)
          throw new BadRequestException('Le PDF dépasse la limite de 10 Mio.');
        const hash = bytesDigest(body),
          entityType = docType(kind);
        const document = await this.documents.upload(
          tenantId,
          {
            entityType,
            entityId: id,
            fileName: `${record.number}-r${record.revision}-${kind}.pdf`,
            mimeType: 'application/pdf',
            body,
            uploadedById: actorId,
          },
          entityType,
          tx,
        );
        await tx.deliveryManifest.updateMany({
          where: { tenantId, loadId, id },
          data:
            kind === 'manifest'
              ? { manifestDocumentId: document.id, manifestFileHash: hash }
              : { labelsDocumentId: document.id, labelsFileHash: hash },
        });
        await this.audit.log(
          {
            tenantId,
            userId: actorId,
            action: AuditAction.CREATE,
            entityType: 'delivery-manifest-file',
            entityId: id,
            after: { kind, documentId: document.id, hash, snapshotHash: row.snapshotHash },
          },
          tx,
        );
        return { ready: true };
      },
      { timeout: 60000 },
    );
    // Verify after releasing the connection. A one-connection pool must work, too.
    await this.download(tenantId, loadId, id, kind);
    return { ready: true };
  }

  async download(tenantId: string, loadId: string, id: string, value: string) {
    const kind = this.kind(value),
      row = await this.find(tenantId, loadId, id);
    this.record(row);
    const documentId = kind === 'manifest' ? row.manifestDocumentId : row.labelsDocumentId;
    const hash = kind === 'manifest' ? row.manifestFileHash : row.labelsFileHash;
    if (!documentId || !hash)
      throw new ConflictException('Préparez d’abord ce PDF depuis le manifeste.');
    const metadata = await this.prisma.document.findFirst({
      where: {
        tenantId,
        id: documentId,
        entityType: docType(kind),
        entityId: id,
        mimeType: 'application/pdf',
      },
      select: { sizeBytes: true },
    });
    if (!metadata || metadata.sizeBytes > MAX_FILE_BYTES)
      throw new ConflictException('Document canonique invalide.');
    const file = await this.documents.download(tenantId, documentId, docType(kind));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_FILE_BYTES) {
        file.stream.destroy();
        throw new ConflictException('Document canonique trop volumineux.');
      }
      chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    if (body.length !== metadata.sizeBytes || bytesDigest(body) !== hash)
      throw new ConflictException('L’intégrité du PDF ne peut pas être vérifiée.');
    // Number generated by SequencesService, sanitized for the HTTP header.
    return {
      body,
      fileName: `${row.number}-r${row.revision}-${kind}.pdf`.replace(/[^\w.-]/g, '_'),
    };
  }
}
