import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  connectedOperationsSettings,
  hrAvailabilityDate,
  reviewDocumentCoordinates,
  DOCUMENT_COORDINATE_ROLES,
  DOCUMENT_COORDINATE_LABELS,
  SUPPLIER_COORDINATE_ROLES,
  SUPPLIER_COORDINATE_LABELS,
  type AuthUser,
  type CoordinateCopy,
  type DocumentCoordinates,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { lockBusinessTenant, nextBusinessVersion } from '../../modules/business/business-lock';
import { SaveDocumentCoordinatesDto } from './document-coordinates.dto';

export type CoordinateDocumentKind =
  | 'service-quote'
  | 'customer-invoice'
  | 'transport-order'
  | 'supplier-order'
  | 'crm-sales-order';
type Tx = Prisma.TransactionClient;
@Injectable()
export class DocumentCoordinatesService {
  constructor(
    private readonly db: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  private async document(tx: Tx, tenantId: string, kind: CoordinateDocumentKind, id: string) {
    if (kind === 'supplier-order') {
      const row = await tx.supplierOrder.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          supplierId: true,
          documentCoordinates: true,
        },
      });
      if (!row) throw new NotFoundException('Commande fournisseur introuvable.');
      return { ...row, owner: { kind: 'supplier' as const, id: row.supplierId } };
    }
    if (kind === 'crm-sales-order') {
      const row = await tx.salesOrder.findFirst({
        where: { tenantId, id },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          companyId: true,
          documentCoordinates: true,
        },
      });
      if (!row) throw new NotFoundException('Commande CRM introuvable.');
      return { ...row, owner: { kind: 'crm-company' as const, id: row.companyId } };
    }
    const row =
      kind === 'service-quote'
        ? await tx.serviceQuote.findFirst({
            where: { tenantId, id },
            select: {
              id: true,
              status: true,
              updatedAt: true,
              partnerId: true,
              documentCoordinates: true,
            },
          })
        : kind === 'transport-order'
          ? await tx.transportOrder.findFirst({
              where: { tenantId, id },
              select: {
                id: true,
                status: true,
                updatedAt: true,
                customerId: true,
                documentCoordinates: true,
              },
            })
          : await tx.customerInvoice.findFirst({
              where: { tenantId, id },
              select: {
                id: true,
                status: true,
                updatedAt: true,
                customerId: true,
                documentCoordinates: true,
              },
            });
    if (!row) throw new NotFoundException('Document introuvable.');
    const owner =
      'partnerId' in row
        ? { kind: 'partner' as const, id: row.partnerId }
        : { kind: 'customer' as const, id: row.customerId };
    return { ...row, owner };
  }
  async context(tx: Tx, tenantId: string) {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const timeZone = connectedOperationsSettings(
      (tenant.settings as Record<string, unknown>)?.connectedOperations,
    ).timeZone;
    return { timeZone, referenceDate: hrAvailabilityDate(new Date().toISOString(), timeZone) };
  }
  private async owner(
    tx: Tx,
    tenantId: string,
    owner: { kind: DocumentCoordinates['owner']['kind']; id: string },
  ) {
    if (owner.kind === 'crm-company') {
      await this.ownership.assertOwned('crmCompany', owner.id, tenantId, tx);
      await tx.$queryRaw`SELECT id FROM crm_companies WHERE "tenantId" = ${tenantId} AND id = ${owner.id} FOR SHARE`;
      const row = await tx.crmCompany.findFirst({
        where: { tenantId, id: owner.id, status: { not: 'INACTIVE' } },
        select: { name: true },
      });
      if (!row) throw new ConflictException('Société CRM inactive ou indisponible.');
      // CRM has no business code; never invent one or infer a Customer identity.
      return { ...owner, code: '', name: row.name };
    }
    await this.ownership.assertOwned(
      owner.kind === 'customer' ? 'customer' : 'businessPartner',
      owner.id,
      tenantId,
      tx,
    );
    // Customer writers also exist outside the business lock; share-lock before reading identity.
    if (owner.kind === 'customer')
      await tx.$queryRaw`SELECT id FROM customers WHERE "tenantId" = ${tenantId} AND id = ${owner.id} FOR SHARE`;
    else
      await tx.$queryRaw`SELECT id FROM business_partners WHERE "tenantId" = ${tenantId} AND id = ${owner.id} FOR SHARE`;
    const row =
      owner.kind === 'customer'
        ? await tx.customer.findFirst({
            where: { tenantId, id: owner.id, isActive: true },
            select: { code: true, name: true },
          })
        : await tx.businessPartner.findFirst({
            where: {
              tenantId,
              id: owner.id,
              active: true,
              ...(owner.kind === 'supplier' ? { isSupplier: true } : { isCustomer: true }),
            },
            select: { code: true, name: true },
          });
    if (!row)
      throw new ConflictException(
        owner.kind === 'supplier'
          ? 'Fournisseur inactif ou rôle fournisseur retiré.'
          : 'Client inactif ou indisponible.',
      );
    return { ...owner, ...row };
  }
  private async current(
    tx: Tx,
    tenantId: string,
    captured: DocumentCoordinates,
  ): Promise<CoordinateCopy[]> {
    const ids = DOCUMENT_COORDINATE_ROLES.flatMap((role) =>
      captured.entries[role] ? [captured.entries[role]!.id] : [],
    );
    const rows = await tx.partyDirectoryEntry.findMany({
      where: {
        tenantId,
        id: { in: ids },
        ...(captured.owner.kind === 'crm-company'
          ? { companyId: captured.owner.id, customerId: null, partnerId: null }
          : captured.owner.kind === 'customer'
            ? { customerId: captured.owner.id, partnerId: null }
            : { partnerId: captured.owner.id, customerId: null }),
      },
      select: { id: true, version: true, data: true },
    });
    return rows as unknown as CoordinateCopy[];
  }
  async get(tenantId: string, kind: CoordinateDocumentKind, id: string) {
    const row = await this.document(this.db, tenantId, kind, id);
    const captured = row.documentCoordinates as unknown as DocumentCoordinates | null;
    const context = await this.context(this.db, tenantId);
    const issues =
      row.status === 'DRAFT' && captured
        ? reviewDocumentCoordinates(
            captured,
            await this.current(this.db, tenantId, captured),
            context.referenceDate,
          )
        : [];
    let identityIssue: string | null = null;
    if (row.status === 'DRAFT' && captured) {
      const owner =
        row.owner.kind === 'crm-company'
          ? await this.db.crmCompany
              .findFirst({
                where: { tenantId, id: row.owner.id, status: { not: 'INACTIVE' } },
                select: { name: true },
              })
              .then((r) => (r ? { ...r, code: '' } : null))
          : row.owner.kind === 'customer'
            ? await this.db.customer.findFirst({
                where: { tenantId, id: row.owner.id, isActive: true },
                select: { name: true, code: true },
              })
            : await this.db.businessPartner.findFirst({
                where: {
                  tenantId,
                  id: row.owner.id,
                  active: true,
                  ...(row.owner.kind === 'supplier' ? { isSupplier: true } : { isCustomer: true }),
                },
                select: { name: true, code: true },
              });
      if (!owner || owner.name !== captured.owner.name || owner.code !== captured.owner.code)
        identityIssue =
          'Le partenaire est inactif, son rôle ou son identité a changé. Revoyez les coordonnées avant engagement.';
    }
    return {
      id,
      status: row.status,
      updatedAt: row.updatedAt,
      owner: row.owner,
      captured,
      issues,
      identityIssue,
      roles: kind === 'supplier-order' ? SUPPLIER_COORDINATE_ROLES : DOCUMENT_COORDINATE_ROLES,
      labels: kind === 'supplier-order' ? SUPPLIER_COORDINATE_LABELS : DOCUMENT_COORDINATE_LABELS,
      ...context,
    };
  }
  async save(
    actor: AuthUser,
    kind: CoordinateDocumentKind,
    id: string,
    dto: SaveDocumentCoordinatesDto,
  ) {
    const tenantId = actor.tenantId;
    if (kind === 'supplier-order' && dto.selections.deliveryAddress !== null)
      throw new BadRequestException(
        'La destination de réception ne provient pas du carnet fournisseur.',
      );
    const result = await this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, tenantId);
      if (kind === 'crm-sales-order')
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const row = await this.document(tx, tenantId, kind, id);
      if (row.status !== 'DRAFT')
        throw new ConflictException('Les coordonnées de ce document sont figées.');
      const updatedAt = nextBusinessVersion(row, dto.expectedUpdatedAt);
      const hasSelection = DOCUMENT_COORDINATE_ROLES.some((r) => dto.selections[r] !== null);
      let captured: DocumentCoordinates | null = null;
      if (hasSelection) {
        const owner = await this.owner(tx, tenantId, row.owner);
        const context = await this.context(tx, tenantId);
        captured = {
          schemaVersion: 1,
          owner,
          entries: { billingAddress: null, deliveryAddress: null, contact: null },
          selectedAt: new Date().toISOString(),
          selectedBy: actor.id,
          reason: dto.reason,
          ...context,
          frozenAt: null,
        };
        // Resolve every reference server-side; payloads never supply snapshot data or owner.
        for (const role of DOCUMENT_COORDINATE_ROLES) {
          const ref = dto.selections[role];
          if (!ref) continue;
          const entry = await tx.partyDirectoryEntry.findFirst({
            where: {
              tenantId,
              id: ref.id,
              ...(owner.kind === 'crm-company'
                ? { companyId: owner.id, customerId: null, partnerId: null }
                : owner.kind === 'customer'
                  ? { customerId: owner.id, partnerId: null }
                  : { partnerId: owner.id, customerId: null }),
            },
            select: { id: true, version: true, data: true },
          });
          if (!entry) throw new NotFoundException('Entrée absente du carnet de ce partenaire.');
          captured.entries[role] = { ...entry, version: ref.version } as unknown as CoordinateCopy;
        }
        const issues = reviewDocumentCoordinates(
          captured,
          await this.current(tx, tenantId, captured),
          context.referenceDate,
        );
        if (issues.length)
          throw new ConflictException(
            issues.map(
              (i) =>
                `${(kind === 'supplier-order' ? SUPPLIER_COORDINATE_LABELS : DOCUMENT_COORDINATE_LABELS)[i.role]} : ${i.message}`,
            ),
          );
      }
      const where = { tenantId, id, status: 'DRAFT' as const, updatedAt: row.updatedAt };
      const data = {
        documentCoordinates: captured
          ? (captured as unknown as Prisma.InputJsonObject)
          : Prisma.DbNull,
        updatedAt,
      };
      const written =
        kind === 'supplier-order'
          ? await tx.supplierOrder.updateMany({ where, data })
          : kind === 'crm-sales-order'
            ? await tx.salesOrder.updateMany({ where, data })
            : kind === 'service-quote'
              ? await tx.serviceQuote.updateMany({ where, data })
              : kind === 'transport-order'
                ? await tx.transportOrder.updateMany({ where, data })
                : await tx.customerInvoice.updateMany({ where, data });
      if (written.count !== 1)
        throw new ConflictException('Le document a changé. Rechargez-le avant de poursuivre.');
      return { before: row.documentCoordinates, after: captured };
    });
    await this.audit.log({
      tenantId,
      userId: actor.id,
      entityType: kind,
      entityId: id,
      action: AuditAction.UPDATE,
      before: { documentCoordinates: result.before },
      after: { documentCoordinates: result.after, reason: dto.reason },
    });
    return this.get(tenantId, kind, id);
  }
  /** Call only inside the workflow transaction, after acquiring the shared business lock. */
  async freeze(
    tx: Tx,
    tenantId: string,
    raw: Prisma.JsonValue | null,
    expectedOwner: { kind: DocumentCoordinates['owner']['kind']; id: string },
  ) {
    if (!raw) return undefined; // Preserve legacy documents; never fabricate a historical snapshot.
    const captured = raw as unknown as DocumentCoordinates;
    if (expectedOwner.kind === 'supplier' && captured.entries?.deliveryAddress)
      throw new ConflictException(
        'La destination de réception ne provient pas du carnet fournisseur.',
      );
    if (
      captured.schemaVersion !== 1 ||
      captured.frozenAt ||
      captured.owner.kind !== expectedOwner.kind ||
      captured.owner.id !== expectedOwner.id
    )
      throw new ConflictException('Coordonnées incohérentes : revoyez le brouillon.');
    const owner = await this.owner(tx, tenantId, expectedOwner);
    if (owner.code !== captured.owner.code || owner.name !== captured.owner.name)
      throw new ConflictException(
        'L’identité du partenaire a changé. Revoyez les coordonnées du document.',
      );
    const context = await this.context(tx, tenantId);
    const issues = reviewDocumentCoordinates(
      captured,
      await this.current(tx, tenantId, captured),
      context.referenceDate,
    );
    if (issues.length)
      throw new ConflictException(
        issues.map(
          (i) =>
            `${(expectedOwner.kind === 'supplier' ? SUPPLIER_COORDINATE_LABELS : DOCUMENT_COORDINATE_LABELS)[i.role]} : ${i.message}`,
        ),
      );
    return {
      ...captured,
      ...context,
      frozenAt: new Date().toISOString(),
    } as unknown as Prisma.InputJsonObject;
  }
}
