import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import { AuditAction, AuthUser, canTransitionSms, SmsStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CryptoService } from '../crypto/crypto.service';
import { TelnyxTransport } from './telnyx.transport';
import type { SendSmsDto, SmsConfigDto } from './sms.controller';
import { SmsWebhooksService } from './sms-webhooks.service';
import { lockBusinessTenant } from '../../modules/business/business-lock';

/** Internal-only hook: source authorization and dossier journal commit BEFORE the network. */
export interface SmsDossierContext {
  fingerprint: string;
  check(tx: Prisma.TransactionClient, replay: boolean): Promise<void>;
  attach(tx: Prisma.TransactionClient, message: { id: string; live: boolean }): Promise<void>;
}

const configSelect = {
  id: true,
  fromNumber: true,
  messagingProfileId: true,
  live: true,
  liveAuthorized: true,
  webhookPublicKey: true,
  webhookOrigin: true,
  lastWebhookAt: true,
  active: true,
  dailyLimit: true,
  updatedAt: true,
} as const;
const messageSelect = {
  id: true,
  actorId: true,
  fromNumber: true,
  toNumber: true,
  text: true,
  live: true,
  status: true,
  deliveryStatus: true,
  deliveryAt: true,
  providerMessageId: true,
  errorCode: true,
  createdAt: true,
} as const;

@Injectable()
export class SmsService {
  constructor(
    private readonly db: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditLogsService,
    private readonly transport: TelnyxTransport,
    private readonly webhooks: SmsWebhooksService,
  ) {}
  private async lock(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sms:${tenantId}`}, 0))`;
  }
  private async human(tx: Prisma.TransactionClient, actor: AuthUser) {
    await tx.$queryRaw`SELECT id FROM users WHERE "tenantId" = ${actor.tenantId} AND id = ${actor.id} FOR SHARE`;
    const user = await tx.user.findFirst({
      where: {
        tenantId: actor.tenantId,
        id: actor.id,
        status: 'ACTIVE',
        NOT: { email: 'service-account@pulsar.local' },
        agentServiceFor: { none: {} },
      },
      select: { id: true },
    });
    if (!user)
      throw new ForbiddenException(
        'Une confirmation par un utilisateur interne actif est requise.',
      );
  }
  async connection(tenantId: string) {
    const row = await this.db.tenantSmsConfig.findUnique({
      where: { tenantId },
      select: { ...configSelect, apiKeyEnc: true },
    });
    const { apiKeyEnc, ...config } = row ?? { apiKeyEnc: null };
    return {
      provider: 'telnyx',
      liveEnabled: !!row?.liveAuthorized,
      webhookPath: row ? `/api/v1/sms/webhooks/${row.id}` : null,
      config: row ? { ...config, hasApiKey: !!apiKeyEnc } : null,
    };
  }
  async configure(actor: AuthUser, dto: SmsConfigDto) {
    return this.db
      .$transaction(async (tx) => {
        await this.lock(tx, actor.tenantId);
        await this.human(tx, actor);
        const old = await tx.tenantSmsConfig.findUnique({ where: { tenantId: actor.tenantId } });
        if ((old?.updatedAt.toISOString() ?? null) !== dto.expectedUpdatedAt)
          throw new ConflictException('La connexion a changé. Rechargez avant de sauvegarder.');
        if (dto.live && dto.active && !dto.apiKey && !old?.apiKeyEnc)
          throw new BadRequestException('Ajoutez une clé Telnyx avant de choisir le mode réel.');
        const identityChanged =
          !!old &&
          (dto.fromNumber !== old.fromNumber ||
            dto.messagingProfileId !== old.messagingProfileId ||
            !!dto.apiKey);
        if (
          dto.live &&
          dto.active &&
          (!old?.liveAuthorized || !old.active || identityChanged) &&
          dto.confirmLive !== true
        )
          throw new BadRequestException('Confirmez l’activation des SMS réels dans Pulsar.');
        const webhookOrigin =
          dto.webhookOrigin === undefined
            ? (old?.webhookOrigin ?? null)
            : dto.webhookOrigin || null;
        if (webhookOrigin) {
          try {
            const url = new URL(webhookOrigin);
            if (
              url.protocol !== 'https:' ||
              url.origin !== webhookOrigin ||
              url.username ||
              url.password ||
              !url.hostname.includes('.') ||
              url.hostname === 'localhost'
            )
              throw new Error();
          } catch {
            throw new BadRequestException(
              'Indiquez l’origine HTTPS publique de Pulsar, sans chemin ni barre finale.',
            );
          }
        }
        const webhookPublicKey = dto.webhookPublicKey ?? old?.webhookPublicKey ?? null;
        if (dto.live && dto.active && (!webhookPublicKey || !webhookOrigin))
          throw new BadRequestException(
            'Configurez la clé publique Telnyx et l’adresse HTTPS Pulsar avant le mode réel.',
          );
        const liveAuthorized = dto.live && (dto.confirmLive === true || !!old?.liveAuthorized);
        const row = await tx.tenantSmsConfig.upsert({
          where: { tenantId: actor.tenantId },
          create: {
            tenantId: actor.tenantId,
            fromNumber: dto.fromNumber,
            messagingProfileId: dto.messagingProfileId,
            live: dto.live,
            liveAuthorized,
            webhookPublicKey,
            webhookOrigin,
            active: dto.active,
            dailyLimit: dto.dailyLimit,
            apiKeyEnc: dto.apiKey ? this.crypto.encryptString(dto.apiKey) : undefined,
          },
          update: {
            fromNumber: dto.fromNumber,
            messagingProfileId: dto.messagingProfileId,
            live: dto.live,
            liveAuthorized,
            webhookPublicKey,
            webhookOrigin,
            active: dto.active,
            dailyLimit: dto.dailyLimit,
            ...(dto.apiKey ? { apiKeyEnc: this.crypto.encryptString(dto.apiKey) } : {}),
            updatedAt: new Date(Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1)),
          },
          select: configSelect,
        });
        await this.audit.log(
          {
            tenantId: actor.tenantId,
            userId: actor.id,
            entityType: 'sms-config',
            entityId: row.id,
            action: AuditAction.UPDATE,
            after: {
              live: row.live,
              active: row.active,
              dailyLimit: row.dailyLimit,
              keyChanged: !!dto.apiKey,
              liveAuthorized,
              webhookConfigured: !!webhookPublicKey && !!webhookOrigin,
            },
          },
          tx,
        );
        return row;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException(
            'Ce profil et ce numéro sont déjà rattachés à une autre connexion Pulsar.',
          );
        throw error;
      });
  }
  async list(tenantId: string, page: number) {
    return this.db.$transaction(
      async (tx) => {
        const where = { tenantId, dossierCommunication: { is: null } };
        return {
          items: await tx.smsMessage.findMany({
            where,
            select: messageSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
            skip: (page - 1) * 20,
          }),
          total: await tx.smsMessage.count({ where }),
          page,
          pageSize: 20,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async send(actor: AuthUser, dto: SendSmsDto, context?: SmsDossierContext) {
    if (dto.confirmed !== true)
      throw new BadRequestException('Confirmez le destinataire et le message.');
    const tenantId = actor.tenantId;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          actorId: actor.id,
          to: dto.toNumber,
          text: dto.text,
          version: dto.expectedUpdatedAt,
          confirmed: dto.confirmed,
          ...(context ? { dossier: context.fingerprint } : {}),
        }),
      )
      .digest('hex');
    const prepared = await this.db.$transaction(async (tx) => {
      if (context) await lockBusinessTenant(tx, tenantId);
      await this.lock(tx, tenantId);
      await this.human(tx, actor);
      const existing = await tx.smsMessage.findUnique({
        where: { tenantId_operationKey: { tenantId, operationKey: dto.operationKey } },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Cette clé désigne un autre envoi.');
        await context?.check(tx, true);
        return { id: existing.id, send: false, apiKeyEnc: null };
      }
      await context?.check(tx, false);
      const preference = await tx.communicationPreference.findUnique({
        where: {
          tenantId_channel_recipient: { tenantId, channel: 'SMS', recipient: dto.toNumber },
        },
      });
      if (preference && !preference.allowed)
        throw new BadRequestException('Ce destinataire a refusé les SMS opérationnels.');
      const config = await tx.tenantSmsConfig.findUnique({ where: { tenantId } });
      if (!config?.active) throw new BadRequestException('Activez la connexion SMS.');
      if (config.updatedAt.toISOString() !== dto.expectedUpdatedAt)
        throw new ConflictException('La connexion a changé. Rechargez et revoyez le message.');
      if (
        config.live &&
        (!config.liveAuthorized ||
          !config.apiKeyEnc ||
          !config.webhookPublicKey ||
          !config.webhookOrigin)
      )
        throw new BadRequestException(
          'Autorisez le mode réel dans la configuration Pulsar et complétez les retours Telnyx.',
        );
      if (
        await tx.smsSuppression.findUnique({
          where: { tenantId_phoneNumber: { tenantId, phoneNumber: dto.toNumber } },
        })
      )
        throw new BadRequestException(
          'Ce destinataire a demandé STOP. Envoi bloqué pour cette entreprise.',
        );
      const midnight = new Date();
      midnight.setUTCHours(0, 0, 0, 0);
      const count = await tx.smsMessage.count({
        where: { tenantId, live: config.live, createdAt: { gte: midnight } },
      });
      if (count >= config.dailyLimit)
        throw new BadRequestException('Plafond quotidien atteint pour ce mode (jour UTC).');
      const row = await tx.smsMessage.create({
        data: {
          tenantId,
          actorId: actor.id,
          operationKey: dto.operationKey,
          fingerprint,
          fromNumber: config.fromNumber,
          toNumber: dto.toNumber,
          text: dto.text,
          messagingProfileId: config.messagingProfileId,
          live: config.live,
          configVersion: config.updatedAt,
          webhookUrl: config.webhookOrigin
            ? `${config.webhookOrigin}/api/v1/sms/webhooks/${config.id}`
            : null,
        },
      });
      await context?.attach(tx, row);
      await this.audit.log(
        {
          tenantId,
          userId: actor.id,
          action: AuditAction.CREATE,
          entityType: 'sms-message',
          entityId: row.id,
          after: { live: row.live, status: row.status },
        },
        tx,
      );
      return { id: row.id, send: true, apiKeyEnc: config.apiKeyEnc };
    });
    const message = await this.db.smsMessage.findFirstOrThrow({
      where: { tenantId, id: prepared.id },
    });
    if (prepared.send) {
      // Decryption failure is terminal/uncertain too: never leave an automatic resend path.
      let result: { status: SmsStatus; providerMessageId?: string; errorCode?: string } = {
        status: SmsStatus.SIMULATED,
      };
      if (message.live) {
        try {
          result = await this.transport.send(
            this.crypto.decryptString(prepared.apiKeyEnc!),
            message,
          );
        } catch {
          result = { status: SmsStatus.UNKNOWN, errorCode: 'CONNECTION_UNCERTAIN' };
        }
      }
      if (!canTransitionSms(message.status as SmsStatus, result.status))
        throw new ConflictException('État SMS incompatible.');
      await this.db.$transaction(async (tx) => {
        await this.lock(tx, tenantId);
        const changed = await tx.smsMessage.updateMany({
          where: { tenantId, id: message.id, status: SmsStatus.SENDING },
          data: result,
        });
        if (changed.count !== 1)
          throw new ConflictException('Le résultat SMS a déjà été enregistré.');
        await this.audit.log(
          {
            tenantId,
            userId: actor.id,
            action: AuditAction.STATUS_CHANGE,
            entityType: 'sms-message',
            entityId: message.id,
            after: result,
          },
          tx,
        );
        if (result.providerMessageId)
          await this.webhooks.reconcile(tx, tenantId, result.providerMessageId);
      });
    }
    return this.db.smsMessage.findFirstOrThrow({
      where: { tenantId, id: message.id },
      select: messageSelect,
    });
  }
}
