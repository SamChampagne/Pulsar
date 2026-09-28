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
import { invoiceCreditRecipient, CreditRecipientProvenance } from './credit-coordinate-source';
import { renderInvoiceDocument, InvoiceDocumentSnapshot } from './invoice-document-render';
import type {
  PublishInvoiceDocumentDto,
  SendInvoiceDocumentDto,
} from './customer-invoice-documents.controller';

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const mailSelect = {
  id: true,
  toAddresses: true,
  status: true,
  deliveryChannel: true,
  deliveryUncertain: true,
  sentAt: true,
  createdAt: true,
};
@Injectable()
export class CustomerInvoiceDocumentsService implements OnModuleInit {
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
    this.mail.registerDeliveryGuard('customer-invoice', async (tenantId, id) => {
      if (!(await this.modules.getEnabledKeys(tenantId)).has(MODULE_KEYS.BILLING)) return 'HOLD';
      const invoice = await this.prisma.customerInvoice.findFirst({
        where: { tenantId, id, status: { not: 'DRAFT' } },
        select: { documentId: true },
      });
      return invoice?.documentId ? 'ALLOW' : 'CANCEL';
    });
  }
  private async invoice(tenantId: string, id: string) {
    const invoice = await this.prisma.customerInvoice.findFirst({
      where: { tenantId, id },
      include: { customer: { select: { name: true, email: true } } },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    if (invoice.status === 'DRAFT')
      throw new ConflictException('Approuvez la facture avant publication.');
    return invoice;
  }
  private async channel(tenantId: string): Promise<'log' | 'smtp'> {
    return (await this.emailConfig.connectionStatus(tenantId)).outbound === 'log' ? 'log' : 'smtp';
  }
  private legacy(tenantId: string, id: string) {
    return this.prisma.emailMessage.findFirst({
      where: { tenantId, relatedType: 'customer-invoice', relatedId: id, deliveryChannel: null },
      select: { id: true },
    });
  }
  async context(tenantId: string, id: string) {
    const invoice = await this.invoice(tenantId, id);
    const snapshot = invoice.documentSnapshot as unknown as InvoiceDocumentSnapshot | null;
    const config = await this.settings.resolve(tenantId, MODULE_KEYS.BILLING);
    const legacy = await this.legacy(tenantId, id);
    return {
      snapshot,
      publishedAt: invoice.publishedAt,
      ready: !!invoice.documentId,
      hash: invoice.documentHash,
      invoiceCoordinates: invoiceCreditRecipient(
        id,
        invoice.customerId,
        invoice.documentCoordinates,
      ),
      capturedContactEmail: snapshot?.recipientProvenance.contactEmail ?? '',
      defaults: snapshot?.identities ?? {
        issuerName: String(config.customerInvoiceIssuerName ?? ''),
        issuerAddress: String(config.customerInvoiceIssuerAddress ?? ''),
        issuerTaxIds: String(config.customerInvoiceIssuerTaxIds ?? ''),
        recipientName: invoice.customer.name,
        recipientAddress: '',
      },
      suggestedEmail: invoice.customer.email ?? '',
      channel: await this.channel(tenantId),
      // Do not silently reuse credit-specific issuer settings for an invoice.
      legacySendBlocked: !!legacy || !!invoice.sentAt || invoice.status === 'SENT',
      automaticSettingsIgnored:
        config.autoSendOnApproval === true || config.autoEmailInvoicePdf === true,
      deliveries: await this.prisma.emailMessage.findMany({
        where: { tenantId, relatedType: 'customer-invoice', relatedId: id },
        select: mailSelect,
        orderBy: { createdAt: 'asc' },
      }),
    };
  }
  async publish(user: AuthUser, id: string, dto: PublishInvoiceDocumentDto) {
    const fromInvoice = dto.recipientSource === 'INVOICE';
    if (
      fromInvoice &&
      (dto.recipientName !== undefined ||
        dto.recipientAddress !== undefined ||
        dto.recipientReason !== undefined)
    )
      throw new BadRequestException(
        'La copie facture est résolue par le serveur, sans coordonnées manuelles.',
      );
    if (!fromInvoice && dto.expectedCoordinatesHash !== undefined)
      throw new BadRequestException('Choisissez explicitement la source facture.');
    const fingerprint = hash(
      JSON.stringify({
        issuerName: dto.issuerName,
        issuerAddress: dto.issuerAddress,
        issuerTaxIds: dto.issuerTaxIds,
        recipientSource: fromInvoice ? 'INVOICE' : 'MANUAL',
        ...(fromInvoice
          ? { expectedCoordinatesHash: dto.expectedCoordinatesHash }
          : {
              recipientName: dto.recipientName,
              recipientAddress: dto.recipientAddress,
              recipientReason: dto.recipientReason ?? '',
            }),
      }),
    );
    const frozen = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_invoices WHERE id = ${id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
      const invoice = await tx.customerInvoice.findFirst({
        where: { tenantId: user.tenantId, id },
        include: { lines: { orderBy: { id: 'asc' } } },
      });
      if (!invoice) throw new NotFoundException('Facture introuvable.');
      if (invoice.status === 'DRAFT')
        throw new ConflictException('Approuvez la facture avant publication.');
      if (invoice.publicationFingerprint) {
        if (invoice.publicationFingerprint !== fingerprint)
          throw new ConflictException('Publication déjà figée. Relisez le document existant.');
        return { invoice, created: false };
      }
      const source = invoiceCreditRecipient(id, invoice.customerId, invoice.documentCoordinates);
      if (fromInvoice && (!source || source.coordinatesHash !== dto.expectedCoordinatesHash))
        throw new ConflictException(
          'Copie figée absente ou différente. Actualisez avant publication.',
        );
      if (!fromInvoice && source && !dto.recipientReason)
        throw new ConflictException('Justifiez la saisie manuelle au lieu de la copie figée.');
      const identities = {
        issuerName: dto.issuerName,
        issuerAddress: dto.issuerAddress,
        issuerTaxIds: dto.issuerTaxIds,
        recipientName: fromInvoice ? source!.recipientName : dto.recipientName!,
        recipientAddress: fromInvoice ? source!.recipientAddress : dto.recipientAddress!,
      };
      const recipientProvenance: CreditRecipientProvenance = fromInvoice
        ? {
            kind: 'INVOICE',
            invoiceId: id,
            coordinatesHash: source!.coordinatesHash,
            frozenAt: source!.frozenAt,
            addressEntryId: source!.addressEntryId,
            addressVersion: source!.addressVersion,
            contactEmail: source!.contactEmail,
          }
        : { kind: 'MANUAL', ...(dto.recipientReason ? { reason: dto.recipientReason } : {}) };
      if (invoice.taxAmount.gt(0) && !identities.issuerTaxIds)
        throw new BadRequestException('Renseignez les inscriptions fiscales applicables.');
      const net = invoice.totalAmount.minus(invoice.taxAmount);
      if (
        !invoice.lines.length ||
        !invoice.lines.reduce((n, l) => n.plus(l.amount), new Prisma.Decimal(0)).equals(net)
      )
        throw new ConflictException(
          'Les lignes ne se rapprochent pas du total approuvé. Vérifiez la facture sans recalculer son historique.',
        );
      const taxLines =
        (
          invoice.taxDetail as {
            lines?: { description: string; rate: number; amount: number }[];
          } | null
        )?.lines ?? [];
      let taxes: InvoiceDocumentSnapshot['taxes'];
      try {
        if (!Array.isArray(taxLines)) throw new Error('Malformed tax snapshot');
        taxes = taxLines.map((t) => {
          const rate = new Prisma.Decimal(t.rate),
            amount = new Prisma.Decimal(t.amount);
          if (
            typeof t.description !== 'string' ||
            !rate.isFinite() ||
            !amount.isFinite() ||
            !amount.equals(amount.toDecimalPlaces(2))
          )
            throw new Error('Malformed tax line');
          return { description: t.description, rate: rate.toString(), amount: amount.toFixed(2) };
        });
      } catch {
        throw new ConflictException(
          'Décomposition fiscale historique invalide. Publication bloquée, sans correction implicite.',
        );
      }
      if (
        !taxes.reduce((n, t) => n.plus(t.amount), new Prisma.Decimal(0)).equals(invoice.taxAmount)
      )
        throw new ConflictException(
          'Décomposition fiscale historique incomplète. Publication bloquée.',
        );
      const snapshot: InvoiceDocumentSnapshot = {
        version: 1,
        identities,
        recipientProvenance,
        number: invoice.invoiceNumber,
        documentDate: new Date().toISOString(),
        approvedAt: invoice.approvedAt?.toISOString() ?? null,
        currency: invoice.currency,
        netAmount: net.toFixed(2),
        taxAmount: invoice.taxAmount.toFixed(2),
        totalAmount: invoice.totalAmount.toFixed(2),
        lines: invoice.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity?.toString() ?? null,
          unitPrice: l.unitPrice?.toString() ?? null,
          amount: l.amount.toFixed(2),
        })),
        taxes,
      };
      const texts = [
        ...Object.values(identities),
        snapshot.number,
        snapshot.currency,
        ...snapshot.lines.map((l) => l.description),
        ...taxes.map((t) => t.description),
      ];
      if (texts.some((t) => /[^\x20-\x7E\xA0-\xFF\n\r\tŒœŸ€‘’“”–—]/u.test(t)))
        throw new BadRequestException(
          'Le PDF prend en charge les caractères latins occidentaux. Aucun document publié.',
        );
      return {
        created: true,
        invoice: await tx.customerInvoice.update({
          where: { tenantId_id: { tenantId: user.tenantId, id } },
          data: {
            documentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            publicationFingerprint: fingerprint,
            publishedAt: new Date(snapshot.documentDate),
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
        entityType: 'customer-invoice',
        entityId: id,
        after: { publicationFrozen: true, fingerprint },
      });
    if (!frozen.invoice.documentId) {
      const body = await renderInvoiceDocument(
        frozen.invoice.documentSnapshot as unknown as InvoiceDocumentSnapshot,
      );
      const doc = await this.documents.upload(
        user.tenantId,
        {
          entityType: 'customer-invoice-pdf',
          entityId: id,
          fileName: this.filename(frozen.invoice.invoiceNumber),
          mimeType: 'application/pdf',
          body,
          uploadedById: user.id,
        },
        'customer-invoice-pdf',
      );
      const attached = await this.prisma.customerInvoice.updateMany({
        where: {
          tenantId: user.tenantId,
          id,
          documentId: null,
          publicationFingerprint: fingerprint,
        },
        data: { documentId: doc.id, documentHash: hash(body) },
      });
      if (attached.count)
        await this.audit.log({
          tenantId: user.tenantId,
          userId: user.id,
          action: AuditAction.UPDATE,
          entityType: 'customer-invoice',
          entityId: id,
          after: { documentId: doc.id, documentHash: hash(body) },
        });
    }
    return this.context(user.tenantId, id);
  }
  private filename(number: string) {
    return `facture-${number.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
  }
  async download(tenantId: string, id: string) {
    const invoice = await this.invoice(tenantId, id);
    if (!invoice.documentId || !invoice.documentHash)
      throw new ConflictException('Le PDF n’est pas disponible.');
    const file = await this.documents.download(
      tenantId,
      invoice.documentId,
      'customer-invoice-pdf',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (hash(body) !== invoice.documentHash)
      throw new ConflictException('Intégrité du PDF invalide. Aucun remplacement automatique.');
    return { body, filename: this.filename(invoice.invoiceNumber) };
  }
  async send(user: AuthUser, id: string, dto: SendInvoiceDocumentDto) {
    const invoice = await this.invoice(user.tenantId, id);
    if (!invoice.documentId || invoice.documentHash !== dto.expectedHash)
      throw new ConflictException('Relisez le PDF publié avant envoi.');
    const key = `customer-invoice:${id}:${dto.expectedChannel}:v1`;
    const existing = await this.prisma.emailMessage.findUnique({
      where: { tenantId_dedupKey: { tenantId: user.tenantId, dedupKey: key } },
    });
    if (existing) {
      if (existing.toAddresses.join() !== dto.to)
        throw new ConflictException(
          'Un autre destinataire est déjà enregistré. Vérifiez l’historique.',
        );
      return this.context(user.tenantId, id);
    }
    if (invoice.sentAt || invoice.status === 'SENT' || (await this.legacy(user.tenantId, id)))
      throw new ConflictException(
        'Envoi historique détecté. Vérification opérateur requise; aucun renvoi automatique.',
      );
    if ((await this.channel(user.tenantId)) !== dto.expectedChannel)
      throw new ConflictException('La connexion courriel a changé. Actualisez et confirmez.');
    const file = await this.download(user.tenantId, id);
    const snapshot = invoice.documentSnapshot as unknown as InvoiceDocumentSnapshot;
    const text = `Veuillez trouver la facture ${snapshot.number} en pièce jointe.\nMontant approuvé : ${snapshot.totalAmount} ${snapshot.currency}.\nLes paiements et avoirs éventuels sont suivis séparément.`;
    const escaped = text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
    const message = await this.mail.queue(
      user.tenantId,
      {
        dedupKey: key,
        toAddresses: [dto.to],
        subject: `Facture ${snapshot.number}`,
        text,
        html: `<p>${escaped.replace(/\n/g, '<br>')}</p>`,
        relatedType: 'customer-invoice',
        relatedId: id,
        createdByUserId: user.id,
        deliveryChannel: dto.expectedChannel,
        attachments: [{ documentId: invoice.documentId, filename: file.filename }],
      },
      'customer-invoice',
    );
    if (message.toAddresses.join() !== dto.to)
      throw new ConflictException('Un envoi concurrent a retenu un autre destinataire.');
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'customer-invoice',
      entityId: id,
      after: { emailMessageId: message.id, channel: dto.expectedChannel },
    });
    // Accounting status is not delivery evidence. No APPROVED→SENT on queue or simulation.
    return this.context(user.tenantId, id);
  }
}
