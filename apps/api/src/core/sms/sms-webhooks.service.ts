import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  canTransitionSmsDelivery,
  isSmsStop,
  SmsDeliveryStatus,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { parseTelnyxEvent, verifyTelnyxWebhook } from './telnyx-webhook';

@Injectable()
export class SmsWebhooksService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async receive(configId: string, raw: Buffer | undefined, timestamp: string, signature: string) {
    const config = await this.db.tenantSmsConfig.findUnique({ where: { id: configId } });
    if (
      !raw ||
      !config?.webhookPublicKey ||
      !verifyTelnyxWebhook(raw, timestamp, signature, config.webhookPublicKey)
    )
      throw new UnauthorizedException('Signature Telnyx invalide ou expirée.');
    let event: ReturnType<typeof parseTelnyxEvent>;
    try {
      // Other signed events need no retry; this receiver supports SMS only.
      const envelope = JSON.parse(raw.toString('utf8'));
      if (!['message.received', 'message.finalized'].includes(envelope?.data?.event_type))
        return { received: true };
      event = parseTelnyxEvent(raw);
    } catch {
      throw new BadRequestException('Événement SMS invalide.');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    await this.db.$transaction(async (tx) => {
      const tenantId = config.tenantId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sms:${tenantId}`}, 0))`;
      const current = await tx.tenantSmsConfig.findUniqueOrThrow({ where: { tenantId } });
      if (current.webhookPublicKey !== config.webhookPublicKey)
        throw new UnauthorizedException('Clé de vérification modifiée.');
      const existing = await tx.smsWebhookEvent.findUnique({
        where: { tenantId_eventId: { tenantId, eventId: event.eventId } },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Événement déjà reçu avec un autre contenu.');
        return;
      }
      const inbound = event.eventType === 'message.received';
      const matchesCurrent =
        event.messagingProfileId === current.messagingProfileId &&
        (inbound ? event.toNumber : event.fromNumber) === current.fromNumber;
      // A historical outbound receipt may belong to the previous number/profile.
      const historical =
        !inbound &&
        (await tx.smsMessage.findFirst({
          where: {
            tenantId,
            live: true,
            providerMessageId: event.providerMessageId,
            messagingProfileId: event.messagingProfileId,
            fromNumber: event.fromNumber,
            toNumber: event.toNumber,
          },
          select: { id: true },
        }));
      if (!matchesCurrent && !historical)
        throw new BadRequestException('Profil ou numéro incompatible avec cette connexion.');
      const row = await tx.smsWebhookEvent.create({ data: { tenantId, fingerprint, ...event } });
      if (inbound && isSmsStop(event.text ?? '')) {
        const blocked = await tx.smsSuppression.findUnique({
          where: { tenantId_phoneNumber: { tenantId, phoneNumber: event.fromNumber } },
        });
        if (!blocked) {
          const suppression = await tx.smsSuppression.create({
            data: { tenantId, phoneNumber: event.fromNumber, sourceEventId: event.eventId },
          });
          await this.audit.log(
            {
              tenantId,
              entityType: 'sms-suppression',
              entityId: suppression.id,
              action: AuditAction.CREATE,
              after: { source: 'telnyx-signed-stop', eventId: event.eventId },
            },
            tx,
          );
        }
      }
      if (!inbound) await this.reconcile(tx, tenantId, event.providerMessageId);
      // Telemetry does not advance the configuration's optimistic-lock version.
      await tx.tenantSmsConfig.update({
        where: { tenantId },
        data: { lastWebhookAt: new Date(), updatedAt: current.updatedAt },
      });
      await this.audit.log(
        {
          tenantId,
          entityType: 'sms-webhook',
          entityId: row.id,
          action: AuditAction.CREATE,
          after: { eventId: event.eventId, eventType: event.eventType },
        },
        tx,
      );
    });
    return { received: true };
  }

  /** Called under the SMS tenant lock, also after storing the provider's send response. */
  async reconcile(tx: Prisma.TransactionClient, tenantId: string, providerMessageId: string) {
    const messages = await tx.smsMessage.findMany({
      where: { tenantId, live: true, providerMessageId },
    });
    if (messages.length !== 1) return; // Never guess in case of ambiguous provider identifiers.
    const message = messages[0];
    const event = await tx.smsWebhookEvent.findFirst({
      where: {
        tenantId,
        providerMessageId,
        eventType: 'message.finalized',
        fromNumber: message.fromNumber,
        toNumber: message.toNumber,
        messagingProfileId: message.messagingProfileId,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    if (
      !event?.deliveryStatus ||
      !canTransitionSmsDelivery(
        message.deliveryStatus as SmsDeliveryStatus,
        event.deliveryStatus as SmsDeliveryStatus,
      )
    )
      return;
    await tx.smsMessage.updateMany({
      where: { tenantId, id: message.id, deliveryStatus: SmsDeliveryStatus.PENDING },
      data: { deliveryStatus: event.deliveryStatus, deliveryAt: event.occurredAt },
    });
    await this.audit.log(
      {
        tenantId,
        entityType: 'sms-message',
        entityId: message.id,
        action: AuditAction.STATUS_CHANGE,
        after: { deliveryStatus: event.deliveryStatus, eventId: event.eventId },
      },
      tx,
    );
  }

  async inbox(tenantId: string, page: number) {
    const where = { tenantId, eventType: 'message.received' };
    return this.db.$transaction(
      async (tx) => ({
        items: await tx.smsWebhookEvent.findMany({
          where,
          select: { id: true, fromNumber: true, toNumber: true, text: true, occurredAt: true },
          take: 20,
          skip: (page - 1) * 20,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        total: await tx.smsWebhookEvent.count({ where }),
        page,
        pageSize: 20,
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async suppressions(tenantId: string, page: number) {
    return this.db.$transaction(
      async (tx) => ({
        items: await tx.smsSuppression.findMany({
          where: { tenantId },
          select: { id: true, phoneNumber: true, createdAt: true },
          take: 20,
          skip: (page - 1) * 20,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        total: await tx.smsSuppression.count({ where: { tenantId } }),
        page,
        pageSize: 20,
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
