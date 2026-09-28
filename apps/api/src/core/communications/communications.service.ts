import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  AuthUser,
  CommunicationChannel,
  communicationHtml,
  DossierEmailStatus,
  canTransitionDossierEmail,
  normalizeCommunicationRecipient,
  PERMISSIONS,
  renderCommunicationTemplate,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { lockBusinessTenant } from '../../modules/business/business-lock';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../email/email.service';
import { EmailConfigService } from '../email/email-config.service';
import { CommunicationContextService } from './communication-context.service';
import {
  CommunicationContextDto,
  CommunicationPreferenceDto,
  CommunicationRecipientDto,
  CommunicationSendDto,
  CommunicationTemplateDto,
} from './communications.dto';

const messageSelect = {
  id: true,
  actorId: true,
  channel: true,
  recipient: true,
  subject: true,
  text: true,
  live: true,
  emailStatus: true,
  createdAt: true,
  contextLabel: true,
  smsMessage: {
    select: { status: true, deliveryStatus: true, deliveryAt: true, providerMessageId: true },
  },
} as const;
const templateSelect = {
  id: true,
  channel: true,
  name: true,
  subject: true,
  text: true,
  active: true,
  updatedAt: true,
} as const;
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly source: CommunicationContextService,
    private readonly audit: AuditLogsService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly emailConfig: EmailConfigService,
  ) {}

  private channel(
    actor: AuthUser,
    channel: CommunicationChannel,
    action: 'READ' | 'SEND' | 'MANAGE' = 'READ',
  ) {
    const permissions = channel === CommunicationChannel.SMS ? PERMISSIONS.SMS : PERMISSIONS.EMAIL;
    if (
      !actor.permissions.includes(PERMISSIONS.CORE.COMMUNICATIONS_READ) ||
      !actor.permissions.includes(permissions.READ) ||
      !actor.permissions.includes(permissions[action])
    )
      throw new ForbiddenException('Vous n’avez pas les droits pour ce canal.');
  }
  private recipient(dto: CommunicationRecipientDto) {
    const value = normalizeCommunicationRecipient(dto.channel, dto.recipient);
    if (!value)
      throw new BadRequestException(
        'Choisissez une adresse courriel unique ou un numéro international E.164 (+1514…).',
      );
    return value;
  }
  private async human(tx: Prisma.TransactionClient, actor: AuthUser) {
    await tx.$queryRaw`SELECT id FROM users WHERE "tenantId" = ${actor.tenantId} AND id = ${actor.id} FOR SHARE`;
    if (
      !(await tx.user.findFirst({
        where: {
          tenantId: actor.tenantId,
          id: actor.id,
          status: 'ACTIVE',
          NOT: { email: 'service-account@pulsar.local' },
          agentServiceFor: { none: {} },
        },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('Une confirmation humaine interne est requise.');
  }
  private async preference(
    tx: Prisma.TransactionClient,
    tenantId: string,
    channel: CommunicationChannel,
    recipient: string,
  ) {
    const row = await tx.communicationPreference.findUnique({
      where: { tenantId_channel_recipient: { tenantId, channel, recipient } },
      select: { allowed: true, version: true, updatedAt: true },
    });
    const stopped =
      channel === CommunicationChannel.SMS &&
      !!(await tx.smsSuppression.findUnique({
        where: { tenantId_phoneNumber: { tenantId, phoneNumber: recipient } },
        select: { id: true },
      }));
    return {
      allowed: row?.allowed ?? null,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      stopped,
    };
  }
  async context(actor: AuthUser, dto: CommunicationContextDto) {
    this.channel(actor, dto.channel);
    return this.db.$transaction(
      async (tx) => {
        const context = await this.source.resolve(tx, actor, dto.access, dto.entityId);
        // Channel rights are applied before projecting contact values or counting messages.
        const recipients = context.recipients.filter((r) => r.channel === dto.channel);
        const where = {
          tenantId: actor.tenantId,
          contextKind: context.kind,
          contextId: context.id,
          channel: dto.channel,
        };
        const smsConfig =
          dto.channel === CommunicationChannel.SMS
            ? await tx.tenantSmsConfig.findUnique({
                where: { tenantId: actor.tenantId },
                select: {
                  active: true,
                  live: true,
                  liveAuthorized: true,
                  updatedAt: true,
                  fromNumber: true,
                },
              })
            : null;
        const emailConfig =
          dto.channel === CommunicationChannel.EMAIL
            ? await tx.tenantEmailConfig.findUnique({
                where: { tenantId: actor.tenantId },
                select: { active: true, host: true, fromEmail: true, updatedAt: true },
              })
            : null;
        return {
          ...context,
          recipients,
          connection:
            dto.channel === CommunicationChannel.SMS
              ? {
                  ready: !!smsConfig?.active && (!smsConfig.live || smsConfig.liveAuthorized),
                  live: !!smsConfig?.live,
                  version: smsConfig?.updatedAt ?? null,
                  from: smsConfig?.fromNumber ?? null,
                }
              : {
                  ready: !emailConfig?.active || !emailConfig.host || !!emailConfig.fromEmail,
                  live: !!emailConfig?.active && !!emailConfig.host,
                  version: emailConfig?.updatedAt ?? null,
                  from: emailConfig?.fromEmail ?? null,
                },
          history: {
            items: await tx.dossierCommunication.findMany({
              where,
              select: messageSelect,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 20,
              skip: (dto.page - 1) * 20,
            }),
            total: await tx.dossierCommunication.count({ where }),
            page: dto.page,
            pageSize: 20,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async getPreference(actor: AuthUser, dto: CommunicationRecipientDto) {
    this.channel(actor, dto.channel);
    await this.source.resolve(this.db, actor, dto.access, dto.entityId);
    return this.preference(this.db, actor.tenantId, dto.channel, this.recipient(dto));
  }
  async setPreference(actor: AuthUser, dto: CommunicationPreferenceDto) {
    this.channel(actor, dto.channel);
    if (!actor.permissions.includes(PERMISSIONS.CORE.COMMUNICATIONS_MANAGE))
      throw new ForbiddenException();
    const recipient = this.recipient(dto);
    if (!dto.confirmed || new Date(dto.observedAt).getTime() > Date.now())
      throw new BadRequestException(
        'Indiquez une preuve déjà recueillie et confirmez la décision.',
      );
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, actor.tenantId);
      // Same SMS lock/order as send and STOP: no authorization can race a STOP.
      if (dto.channel === CommunicationChannel.SMS)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sms:${actor.tenantId}`}, 0))`;
      await this.human(tx, actor);
      const context = await this.source.resolve(tx, actor, dto.access, dto.entityId);
      if (!context.canManageSource)
        throw new ForbiddenException('La gestion du dossier est requise.');
      const old = await this.preference(tx, actor.tenantId, dto.channel, recipient);
      if (old.version !== dto.expectedVersion)
        throw new ConflictException('La préférence a changé. Rechargez-la.');
      if (old.stopped && dto.allowed)
        throw new BadRequestException(
          'STOP reste bloquant. Ce panneau ne réactive pas un numéro désabonné.',
        );
      const row = await tx.communicationPreference.upsert({
        where: {
          tenantId_channel_recipient: { tenantId: actor.tenantId, channel: dto.channel, recipient },
        },
        create: { tenantId: actor.tenantId, channel: dto.channel, recipient, allowed: dto.allowed },
        update: { allowed: dto.allowed, version: { increment: 1 } },
      });
      await this.audit.log(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          action: AuditAction.UPDATE,
          entityType: 'communication-preference',
          entityId: row.id,
          before: { allowed: old.allowed, version: old.version },
          after: {
            allowed: row.allowed,
            version: row.version,
            channel: dto.channel,
            recipient,
            evidence: dto.evidence,
            observedAt: dto.observedAt,
            contextKind: context.kind,
            contextId: context.id,
          },
        },
        tx,
      );
      return this.preference(tx, actor.tenantId, dto.channel, recipient);
    });
  }
  private async prepare(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    dto: CommunicationSendDto,
    replay: boolean,
  ) {
    const context = await this.source.resolve(tx, actor, dto.access, dto.entityId);
    if (replay) return context;
    if (context.reviewToken !== dto.reviewToken)
      throw new ConflictException(
        'Le dossier ou ses coordonnées ont changé. Rechargez et revoyez le message.',
      );
    const pref = await this.preference(tx, actor.tenantId, dto.channel, this.recipient(dto));
    if (pref.stopped || pref.allowed !== true)
      throw new BadRequestException(
        'Une autorisation opérationnelle explicite est requise. STOP reste bloquant.',
      );
    if (pref.version !== dto.preferenceVersion)
      throw new ConflictException('La préférence a changé. Revoyez-la avant l’envoi.');
    return context;
  }
  async send(actor: AuthUser, dto: CommunicationSendDto) {
    this.channel(actor, dto.channel, 'SEND');
    if (!dto.confirmed) throw new BadRequestException('Confirmez l’aperçu et le destinataire.');
    const recipient = this.recipient(dto),
      tenantId = actor.tenantId;
    if (dto.channel === CommunicationChannel.SMS && dto.text.length > 1600)
      throw new BadRequestException('SMS limité à 1 600 caractères.');
    if (dto.channel === CommunicationChannel.EMAIL && !dto.subject?.trim())
      throw new BadRequestException('Objet requis.');
    if (dto.channel === CommunicationChannel.SMS && dto.subject?.trim())
      throw new BadRequestException('Un SMS n’a pas d’objet.');
    if (/\{\{|\}\}/.test(dto.text + (dto.subject ?? '')))
      throw new BadRequestException('Remplacez toutes les variables avant l’envoi.');
    const fp = fingerprint({
      actorId: actor.id,
      access: dto.access,
      entityId: dto.entityId,
      channel: dto.channel,
      recipient,
      subject: dto.subject ?? '',
      text: dto.text,
      reviewToken: dto.reviewToken,
      configVersion: dto.configVersion,
      preferenceVersion: dto.preferenceVersion,
    });
    if (dto.channel === CommunicationChannel.SMS) {
      if (!dto.configVersion) throw new BadRequestException('Configurez la connexion SMS.');
      let context: Awaited<ReturnType<CommunicationContextService['resolve']>>;
      await this.sms.send(
        actor,
        {
          operationKey: dto.operationKey,
          expectedUpdatedAt: dto.configVersion,
          toNumber: recipient,
          text: dto.text,
          confirmed: true,
        },
        {
          fingerprint: fp,
          check: async (tx, replay) => {
            context = await this.prepare(tx, actor, dto, replay);
          },
          attach: async (tx, message) => {
            const row = await tx.dossierCommunication.create({
              data: {
                tenantId,
                actorId: actor.id,
                contextKind: context.kind,
                contextId: context.id,
                contextLabel: context.title,
                operationKey: dto.operationKey,
                fingerprint: fp,
                channel: dto.channel,
                recipient,
                text: dto.text,
                preferenceVersion: dto.preferenceVersion,
                smsMessageId: message.id,
                live: message.live,
              },
            });
            await this.created(tx, actor, row.id, context.kind, context.id);
          },
        },
      );
    } else {
      const prepared = await this.db.$transaction(async (tx) => {
        await lockBusinessTenant(tx, tenantId);
        await this.human(tx, actor);
        const existing = await tx.dossierCommunication.findUnique({
          where: { tenantId_operationKey: { tenantId, operationKey: dto.operationKey } },
        });
        const context = await this.prepare(tx, actor, dto, !!existing);
        if (existing) {
          if (existing.fingerprint !== fp)
            throw new ConflictException('Cette clé désigne un autre envoi.');
          return { id: existing.id, send: false, config: null };
        }
        await tx.$queryRaw`SELECT id FROM tenant_email_configs WHERE "tenantId" = ${tenantId} FOR SHARE`;
        const config = await tx.tenantEmailConfig.findUnique({ where: { tenantId } });
        if ((config?.updatedAt.toISOString() ?? null) !== dto.configVersion)
          throw new ConflictException('La connexion courriel a changé. Revoyez le mode d’envoi.');
        const live = !!config?.active && !!config.host;
        if (live && !config.fromEmail)
          throw new BadRequestException('Configurez l’adresse expéditeur dans Pulsar.');
        const row = await tx.dossierCommunication.create({
          data: {
            tenantId,
            actorId: actor.id,
            contextKind: context.kind,
            contextId: context.id,
            contextLabel: context.title,
            operationKey: dto.operationKey,
            fingerprint: fp,
            channel: dto.channel,
            recipient,
            subject: dto.subject,
            text: dto.text,
            preferenceVersion: dto.preferenceVersion,
            live,
            emailStatus: 'SENDING',
          },
        });
        await this.created(tx, actor, row.id, context.kind, context.id);
        return { id: row.id, send: true, config: live ? config : null };
      });
      if (prepared.send) {
        let status = DossierEmailStatus.SIMULATED;
        if (prepared.config) {
          status = DossierEmailStatus.UNKNOWN;
          try {
            const transport = this.emailConfig.resolveSnapshot(prepared.config);
            if (
              transport &&
              (await this.email.send(
                {
                  to: recipient,
                  subject: dto.subject!,
                  text: dto.text,
                  html: communicationHtml(dto.text),
                  messageId: `<${prepared.id}@pulsar.local>`,
                },
                transport,
              ))
            )
              status = DossierEmailStatus.ACCEPTED;
          } catch {
            /* No retry: SMTP can have accepted a message before disconnecting. */
          }
        }
        await this.db.$transaction(async (tx) => {
          if (!canTransitionDossierEmail(DossierEmailStatus.SENDING, status))
            throw new ConflictException();
          const changed = await tx.dossierCommunication.updateMany({
            where: { tenantId, id: prepared.id, emailStatus: 'SENDING' },
            data: { emailStatus: status },
          });
          if (changed.count !== 1) throw new ConflictException('Résultat déjà enregistré.');
          await this.audit.log(
            {
              tenantId,
              userId: actor.id,
              entityType: 'dossier-communication',
              entityId: prepared.id,
              action: AuditAction.STATUS_CHANGE,
              after: { status },
            },
            tx,
          );
        });
      }
    }
    return this.db.dossierCommunication.findFirstOrThrow({
      where: { tenantId, operationKey: dto.operationKey },
      select: messageSelect,
    });
  }
  private created(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    id: string,
    contextKind: string,
    contextId: string,
  ) {
    return this.audit.log(
      {
        tenantId: actor.tenantId,
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: 'dossier-communication',
        entityId: id,
        after: { contextKind, contextId, confirmed: true },
      },
      tx,
    );
  }
  async templates(actor: AuthUser, channel: CommunicationChannel) {
    this.channel(actor, channel);
    return this.db.communicationTemplate.findMany({
      where: { tenantId: actor.tenantId, channel },
      select: templateSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }
  async saveTemplate(actor: AuthUser, id: string | null, dto: CommunicationTemplateDto) {
    this.channel(actor, dto.channel, 'MANAGE');
    if (!actor.permissions.includes(PERMISSIONS.CORE.COMMUNICATIONS_MANAGE))
      throw new ForbiddenException();
    if (dto.channel === 'SMS' && (dto.text.length > 1600 || dto.subject?.trim()))
      throw new BadRequestException('SMS : texte de 1 600 caractères maximum, sans objet.');
    if (dto.channel === 'EMAIL' && !dto.subject?.trim())
      throw new BadRequestException('Objet requis.');
    const rendered = renderCommunicationTemplate(dto.text + (dto.subject ?? ''), {
      dossier: 'dossier',
      client: 'client',
      destinataire: 'destinataire',
    });
    if (rendered.missing.length || /\{\{|\}\}/.test(rendered.value))
      throw new BadRequestException('Variables disponibles : dossier, client, destinataire.');
    return this.db.$transaction(async (tx) => {
      await lockBusinessTenant(tx, actor.tenantId);
      await this.human(tx, actor);
      const old = id
        ? await tx.communicationTemplate.findFirst({
            where: { tenantId: actor.tenantId, id, channel: dto.channel },
          })
        : null;
      if (id && !old) throw new NotFoundException();
      if ((old?.updatedAt.toISOString() ?? null) !== dto.expectedUpdatedAt)
        throw new ConflictException('Le modèle a changé. Rechargez-le.');
      if (
        !id &&
        (await tx.communicationTemplate.count({
          where: { tenantId: actor.tenantId, channel: dto.channel },
        })) >= 100
      )
        throw new BadRequestException(
          'Limite de 100 modèles par canal. Modifiez un modèle existant.',
        );
      const data = {
        name: dto.name.trim(),
        subject: dto.subject || null,
        text: dto.text,
        active: dto.active,
        updatedAt: new Date(Math.max(Date.now(), (old?.updatedAt.getTime() ?? 0) + 1)),
      };
      const row = old
        ? await tx.communicationTemplate.update({
            where: { id: old.id, tenantId: actor.tenantId },
            data,
            select: templateSelect,
          })
        : await tx.communicationTemplate.create({
            data: { ...data, tenantId: actor.tenantId, channel: dto.channel },
            select: templateSelect,
          });
      await this.audit.log(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          entityType: 'communication-template',
          entityId: row.id,
          action: old ? AuditAction.UPDATE : AuditAction.CREATE,
          after: { name: row.name, active: row.active, channel: row.channel },
        },
        tx,
      );
      return row;
    });
  }
}
