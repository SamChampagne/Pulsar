import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { AuditAction, AuthUser, MODULE_KEYS } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { MailService } from '../../core/email/mail.service';
import { EmailConfigService } from '../../core/email/email-config.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { invoiceCreditRecipient, type CreditRecipientProvenance } from './credit-coordinate-source';
import {
  renderCreditDocument,
  type CreditDocumentSnapshot,
  type CreditIdentities,
} from './credit-document-render';
import type {
  PublishCreditDocumentDto,
  SendCreditDocumentDto,
} from './customer-credit-documents.controller';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const deliveryKey = (id: string, channel: string) => `customer-credit:${id}:${channel}:v1`;
const mailSelect = {
  id: true,
  toAddresses: true,
  status: true,
  deliveryChannel: true,
  deliveryUncertain: true,
  sentAt: true,
  createdAt: true,
} satisfies Prisma.EmailMessageSelect;
@Injectable()
export class CustomerCreditDocumentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly mail: MailService,
    private readonly emailConfig: EmailConfigService,
    private readonly settings: ModuleSettingsService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}
  onModuleInit() {
    this.mail.registerDeliveryGuard('customer-credit', async (tenantId, id) => {
      if (!(await this.modules.getEnabledKeys(tenantId)).has(MODULE_KEYS.BILLING)) return 'HOLD';
      const note = await this.prisma.customerCreditNote.findFirst({
        where: { tenantId, id, status: 'ISSUED' },
        select: { documentId: true },
      });
      return note?.documentId ? 'ALLOW' : 'CANCEL';
    });
  }
  private async note(tenantId: string, invoiceId: string, id: string) {
    const note = await this.prisma.customerCreditNote.findFirst({
      where: { tenantId, invoiceId, id },
      include: {
        invoice: {
          select: {
            id: true,
            customerId: true,
            documentCoordinates: true,
            invoiceNumber: true,
            customer: { select: { name: true, email: true } },
          },
        },
        lines: { orderBy: { id: 'asc' } },
      },
    });
    if (!note) throw new NotFoundException('Avoir introuvable.');
    if (note.status !== 'ISSUED')
      throw new ConflictException('Validez l’avoir avant de préparer le document.');
    return note;
  }
  private async channel(tenantId: string): Promise<'log' | 'smtp'> {
    return (await this.emailConfig.connectionStatus(tenantId)).outbound === 'log' ? 'log' : 'smtp';
  }
  async context(tenantId: string, invoiceId: string, id: string) {
    const note = await this.note(tenantId, invoiceId, id);
    const config = await this.settings.resolve(tenantId, MODULE_KEYS.BILLING);
    const snapshot = note.documentSnapshot as unknown as CreditDocumentSnapshot | null;
    return {
      snapshot,
      publishedAt: note.publishedAt,
      ready: !!note.documentId,
      hash: note.documentHash,
      invoiceCoordinates: invoiceCreditRecipient(
        note.invoiceId,
        note.invoice.customerId,
        note.invoice.documentCoordinates,
      ),
      capturedContactEmail: snapshot?.recipientProvenance?.contactEmail ?? '',
      defaults: snapshot?.identities ?? {
        issuerName: String(config.creditIssuerName ?? ''),
        issuerAddress: String(config.creditIssuerAddress ?? ''),
        issuerTaxIds: String(config.creditIssuerTaxIds ?? ''),
        recipientName: note.invoice.customer.name,
        recipientAddress: '',
      },
      suggestedEmail: note.invoice.customer.email ?? '',
      channel: await this.channel(tenantId),
      deliveries: await this.prisma.emailMessage.findMany({
        where: { tenantId, relatedType: 'customer-credit', relatedId: id },
        select: mailSelect,
        orderBy: { createdAt: 'asc' },
      }),
    };
  }
  async publish(user: AuthUser, invoiceId: string, id: string, dto: PublishCreditDocumentDto) {
    const fromInvoice = dto.recipientSource === 'INVOICE';
    if (
      fromInvoice &&
      (dto.recipientName !== undefined ||
        dto.recipientAddress !== undefined ||
        dto.recipientReason !== undefined)
    )
      throw new BadRequestException(
        'La copie facture est résolue par le serveur; ne fournissez pas de coordonnées manuelles.',
      );
    if (!fromInvoice && dto.expectedCoordinatesHash !== undefined)
      throw new BadRequestException(
        'Choisissez explicitement la source facture pour utiliser son empreinte.',
      );
    const requestedIdentities: CreditIdentities = {
      issuerName: dto.issuerName,
      issuerAddress: dto.issuerAddress,
      issuerTaxIds: dto.issuerTaxIds,
      recipientName: dto.recipientName ?? '',
      recipientAddress: dto.recipientAddress ?? '',
    };
    // Preserve historical manual fingerprints. Invoice-source retries bind the reviewed hash,
    // never today's client or directory. This also resumes storage failures from the same snapshot.
    const fingerprint = hash(
      JSON.stringify(
        fromInvoice
          ? {
              issuerName: dto.issuerName,
              issuerAddress: dto.issuerAddress,
              issuerTaxIds: dto.issuerTaxIds,
              recipientSource: 'INVOICE',
              expectedCoordinatesHash: dto.expectedCoordinatesHash,
            }
          : dto.recipientReason
            ? { ...requestedIdentities, recipientReason: dto.recipientReason }
            : requestedIdentities,
      ),
    );
    const frozen = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_credit_notes WHERE id = ${id} AND "tenantId" = ${user.tenantId} AND "invoiceId" = ${invoiceId} FOR UPDATE`;
      const note = await tx.customerCreditNote.findFirst({
        where: { tenantId: user.tenantId, invoiceId, id },
        include: {
          invoice: { select: { invoiceNumber: true, customerId: true, documentCoordinates: true } },
          lines: { orderBy: { id: 'asc' } },
        },
      });
      if (!note) throw new NotFoundException('Avoir introuvable.');
      if (note.status !== 'ISSUED' || !note.issuedAt)
        throw new ConflictException('L’avoir doit être validé.');
      if (note.publicationFingerprint) {
        if (note.publicationFingerprint !== fingerprint)
          throw new ConflictException(
            'Coordonnées déjà figées. Relisez le document existant; elles ne peuvent plus être remplacées.',
          );
        return { note, created: false };
      }
      const source = invoiceCreditRecipient(
        invoiceId,
        note.invoice.customerId,
        note.invoice.documentCoordinates,
      );
      let identities = requestedIdentities;
      let recipientProvenance: CreditRecipientProvenance;
      if (fromInvoice) {
        if (!source || source.coordinatesHash !== dto.expectedCoordinatesHash)
          throw new ConflictException(
            'Adresse de facturation figée absente ou différente. Relisez la source avant publication.',
          );
        identities = {
          ...requestedIdentities,
          recipientName: source.recipientName,
          recipientAddress: source.recipientAddress,
        };
        recipientProvenance = {
          kind: 'INVOICE',
          invoiceId,
          coordinatesHash: source.coordinatesHash,
          frozenAt: source.frozenAt,
          addressEntryId: source.addressEntryId,
          addressVersion: source.addressVersion,
          contactEmail: source.contactEmail,
        };
      } else {
        if (source && !dto.recipientReason)
          throw new ConflictException(
            'Expliquez pourquoi vous utilisez une saisie manuelle au lieu des coordonnées figées de la facture.',
          );
        recipientProvenance = {
          kind: 'MANUAL',
          ...(dto.recipientReason ? { reason: dto.recipientReason } : {}),
        };
      }
      // Only print supported text. No silent transliteration of a captured legal identity.
      for (const value of Object.values(identities))
        if (/[^\x20-\x7E\xA0-\xFF\n\r\tŒœŸ€‘’“”–—]/u.test(value))
          throw new BadRequestException(
            'Le PDF prend en charge les caractères latins occidentaux. Vérifiez les coordonnées.',
          );
      if (note.taxAmount.gt(0) && !identities.issuerTaxIds)
        throw new BadRequestException(
          'Indiquez les inscriptions fiscales applicables aux taxes créditées.',
        );
      const now = new Date();
      const snapshot: CreditDocumentSnapshot = {
        version: 1,
        identities,
        recipientProvenance,
        number: note.number,
        invoiceNumber: note.invoice.invoiceNumber,
        documentDate: now.toISOString(),
        accountingDate: note.issuedAt.toISOString(),
        currency: note.currency,
        reason: note.reason,
        netAmount: note.netAmount.toFixed(2),
        taxAmount: note.taxAmount.toFixed(2),
        totalAmount: note.totalAmount.toFixed(2),
        lines: note.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toString(),
          netAmount: line.netAmount.toFixed(2),
          taxAmount: line.taxAmount.toFixed(2),
          totalAmount: line.totalAmount.toFixed(2),
          taxes: (line.taxDetail as { description: string; rate: number; amount: number }[]).map(
            (tax) => ({
              description: tax.description,
              rate: String(tax.rate),
              amount: new Prisma.Decimal(tax.amount).toFixed(2),
            }),
          ),
        })),
      };
      const texts = [
        snapshot.reason,
        snapshot.number,
        snapshot.invoiceNumber,
        snapshot.currency,
        ...snapshot.lines.flatMap((line) => [
          line.description,
          ...line.taxes.map((tax) => tax.description),
        ]),
      ];
      if (texts.some((value) => /[^\x20-\x7E\xA0-\xFF\n\r\tŒœŸ€‘’“”–—]/u.test(value)))
        throw new BadRequestException(
          'Une désignation figée contient des caractères non pris en charge par le PDF latin occidental. Aucun document n’a été publié.',
        );
      return {
        created: true,
        note: await tx.customerCreditNote.update({
          where: { tenantId_id: { tenantId: user.tenantId, id } },
          data: {
            documentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            publicationFingerprint: fingerprint,
            publishedAt: now,
            publishedById: user.id,
          },
        }),
      };
    });
    if (frozen.created)
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: AuditAction.UPDATE,
        entityType: 'customer-credit',
        entityId: id,
        after: { publicationFrozen: true, fingerprint },
      });
    if (!frozen.note.documentId) {
      const snapshot = frozen.note.documentSnapshot as unknown as CreditDocumentSnapshot;
      const body = await renderCreditDocument(snapshot);
      const document = await this.documents.upload(
        user.tenantId,
        {
          entityType: 'customer-credit-pdf',
          entityId: id,
          fileName: `avoir-${snapshot.number.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`,
          mimeType: 'application/pdf',
          body,
          uploadedById: user.id,
        },
        'customer-credit-pdf',
      );
      const attached = await this.prisma.customerCreditNote.updateMany({
        where: {
          tenantId: user.tenantId,
          invoiceId,
          id,
          documentId: null,
          publicationFingerprint: fingerprint,
        },
        data: { documentId: document.id, documentHash: hash(body) },
      });
      // Never delete a file after an uncertain DB response. A concurrent loser remains a protected orphan.
      if (attached.count)
        await this.audit.log({
          tenantId: user.tenantId,
          userId: user.id,
          action: AuditAction.UPDATE,
          entityType: 'customer-credit',
          entityId: id,
          after: { documentId: document.id, documentHash: hash(body) },
        });
    }
    return this.context(user.tenantId, invoiceId, id);
  }
  async download(tenantId: string, invoiceId: string, id: string) {
    const note = await this.note(tenantId, invoiceId, id);
    if (!note.documentId || !note.documentHash)
      throw new ConflictException('Le PDF n’est pas encore disponible.');
    const file = await this.documents.download(tenantId, note.documentId, 'customer-credit-pdf');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (hash(body) !== note.documentHash)
      throw new ConflictException(
        'Intégrité du PDF invalide. Aucun document de remplacement ne sera généré.',
      );
    return { body, filename: `avoir-${note.number.replace(/[^A-Za-z0-9-]/g, '_')}.pdf` };
  }
  async send(user: AuthUser, invoiceId: string, id: string, dto: SendCreditDocumentDto) {
    const note = await this.note(user.tenantId, invoiceId, id);
    if (!note.documentId || note.documentHash !== dto.expectedHash)
      throw new ConflictException('Relisez le PDF publié avant envoi.');
    const key = deliveryKey(id, dto.expectedChannel);
    const existing = await this.prisma.emailMessage.findUnique({
      where: { tenantId_dedupKey: { tenantId: user.tenantId, dedupKey: key } },
    });
    if (existing) {
      if (existing.toAddresses.join() !== dto.to)
        throw new ConflictException(
          'Un envoi existe déjà pour un autre destinataire. Vérifiez son historique.',
        );
      // Replay never resends, including a failed or uncertain delivery.
      return this.context(user.tenantId, invoiceId, id);
    }
    if ((await this.channel(user.tenantId)) !== dto.expectedChannel)
      throw new ConflictException(
        'La connexion courriel a changé. Actualisez et confirmez à nouveau.',
      );
    const file = await this.download(user.tenantId, invoiceId, id);
    const snapshot = note.documentSnapshot as unknown as CreditDocumentSnapshot;
    const text = `Veuillez trouver en pièce jointe la note de crédit ${snapshot.number}, relative à la facture ${snapshot.invoiceNumber}.\nMontant crédité : ${snapshot.totalAmount} ${snapshot.currency}.\nCe document n’est pas un remboursement bancaire.`;
    const escaped = text.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
    const message = await this.mail.queue(
      user.tenantId,
      {
        dedupKey: key,
        toAddresses: [dto.to],
        subject: `Note de crédit ${snapshot.number}`,
        text,
        html: `<p>${escaped.replace(/\n/g, '<br>')}</p>`,
        relatedType: 'customer-credit',
        relatedId: id,
        createdByUserId: user.id,
        deliveryChannel: dto.expectedChannel,
        attachments: [{ documentId: note.documentId, filename: file.filename }],
      },
      'customer-credit',
    );
    if (message.toAddresses.join() !== dto.to)
      throw new ConflictException('Un envoi concurrent a déjà retenu un autre destinataire.');
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'customer-credit',
      entityId: id,
      after: { emailMessageId: message.id, channel: dto.expectedChannel },
    });
    return this.context(user.tenantId, invoiceId, id);
  }
}
