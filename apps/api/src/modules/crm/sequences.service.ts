import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { isEmail } from 'class-validator';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  CommunicationConsent,
  CrmSequenceMode,
  CrmSequenceRunStatus,
  CrmSequenceStepStatus,
  MODULE_KEYS,
  PERMISSIONS,
  canTransitionCrmSequenceRun,
  canTransitionCrmSequenceStep,
  deriveIdempotencyKey,
  renderSequenceText,
  sequenceEmailHtml,
  sequenceStepDue,
  type CrmSequenceStep,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { MailService } from '../../core/email/mail.service';
import {
  AGENT_TOOL_SERVICES,
  TOOL_BY_NAME,
  type ToolServices,
} from '../../core/agents/tool-registry';
import type { AgentsService } from '../../core/agents/agents.service';
import type { ProposedActionsService } from '../../core/agents/proposed-actions.service';
import type { AgentPrincipal } from '../../core/agents/agent-principal';
import { paginationArgs, paginated } from '../../common/pagination';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { EmailPreferenceDto, SaveSequenceDto, SequenceRunsQueryDto } from './dto/sequence.dto';

const TOOL = 'send_crm_sequence_email';
const RELATED = 'crm-sequence-step';
const stepInclude = { run: { include: { sequence: true } } } as const;

@Injectable()
export class SequencesService implements OnModuleInit {
  private readonly logger = new Logger(SequencesService.name);
  private busy = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly mail: MailService,
    private readonly modules: ModuleRef,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.mail.registerDeliveryGuard(RELATED, (tenantId, id) => this.deliveryGuard(tenantId, id));
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmSequence.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.crmSequence.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const item = await this.prisma.crmSequence.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Scénario introuvable');
    return item;
  }

  private async assertEnabled(tenantId: string) {
    const enabled = await this.prisma.tenantModule.findFirst({
      where: {
        tenantId,
        enabled: true,
        module: { key: MODULE_KEYS.CRM },
        tenant: { status: 'ACTIVE' },
      },
      select: { tenantId: true },
    });
    if (!enabled) throw new BadRequestException('CRM désactivé ou entreprise suspendue');
  }

  /** Runtime-independent identity, resolved by the same key validation as MCP. */
  private async principal(tenantId: string, agentId: string): Promise<AgentPrincipal> {
    await this.assertEnabled(tenantId);
    const owned = await this.prisma.agent.findFirst({
      where: { id: agentId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new BadRequestException('Agent introuvable');
    // Lazy resolution: CRM must not import AgentsModule (circular module graph).
    const agents = this.modules.get<AgentsService>(
      require('../../core/agents/agents.service').AgentsService,
      { strict: false },
    );
    const principal = await agents.validateKey(agents.mintSessionToken(agentId, 60)).catch(() => {
      throw new BadRequestException('L’agent doit être actif');
    });
    if (
      ![PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND].every((p) =>
        principal.user.permissions.includes(p),
      )
    ) {
      throw new BadRequestException('L’agent doit détenir crm.manage et core.email.send');
    }
    if (principal.caps.toolAllowlist && !principal.caps.toolAllowlist.includes(TOOL)) {
      throw new BadRequestException('Outil de suivi absent de la liste autorisée de l’agent');
    }
    return principal;
  }

  async save(tenantId: string, userId: string, dto: SaveSequenceDto, id?: string) {
    if (!dto.name.trim()) throw new BadRequestException('Le nom du scénario est requis');
    for (const step of dto.steps) {
      try {
        renderSequenceText(step.subject, { name: '', company: '' });
        renderSequenceText(step.body, { name: '', company: '' });
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }
    if (dto.mode === CrmSequenceMode.GOVERNED) {
      if (!dto.agentId) throw new BadRequestException('Choisissez un agent pour le mode gouverné');
      await this.principal(tenantId, dto.agentId);
    } else if (dto.agentId) {
      throw new BadRequestException('Aucun agent nécessaire en simulation');
    }
    const data = {
      name: dto.name.trim(),
      enabled: dto.enabled,
      mode: dto.mode,
      trigger: dto.trigger,
      agentId: dto.agentId ?? null,
      steps: dto.steps as unknown as Prisma.InputJsonValue,
    };
    let item;
    if (id) {
      const updated = await this.prisma.crmSequence.updateMany({ where: { id, tenantId }, data });
      if (!updated.count) throw new NotFoundException('Scénario introuvable');
      item = await this.get(tenantId, id);
    } else {
      item = await this.prisma.crmSequence.create({
        data: { ...data, tenantId, createdById: userId },
      });
    }
    await this.audit.log({
      tenantId,
      userId,
      action: id ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'crm-sequence',
      entityId: item.id,
      after: { name: item.name, mode: item.mode, enabled: item.enabled },
    });
    return item;
  }

  private async contact(tenantId: string, id: string) {
    const item = await this.prisma.crmContact.findFirst({
      where: { id, tenantId },
      include: { company: { select: { name: true } } },
    });
    if (!item) throw new NotFoundException('Contact introuvable');
    const email = item.email?.trim().toLowerCase();
    if (!email || !isEmail(email))
      throw new BadRequestException('Le contact doit avoir une adresse courriel valide');
    return { ...item, email };
  }

  async preference(tenantId: string, contactId: string) {
    const contact = await this.contact(tenantId, contactId);
    const item = await this.prisma.crmEmailPreference.findUnique({
      where: { tenantId_email: { tenantId, email: contact.email } },
      select: { consent: true, source: true, updatedAt: true },
    });
    return {
      email: contact.email,
      consent: item?.consent ?? CommunicationConsent.UNKNOWN,
      source: item?.source ?? null,
      updatedAt: item?.updatedAt ?? null,
    };
  }

  async setPreference(
    tenantId: string,
    contactId: string,
    userId: string,
    dto: EmailPreferenceDto,
  ) {
    if (dto.source.trim().length < 3)
      throw new BadRequestException('Documentez la source du consentement');
    const contact = await this.contact(tenantId, contactId);
    await this.prisma.crmEmailPreference.upsert({
      where: { tenantId_email: { tenantId, email: contact.email } },
      create: {
        tenantId,
        email: contact.email,
        consent: dto.consent,
        source: dto.source,
        updatedById: userId,
        unsubscribeToken: randomBytes(24).toString('base64url'),
      },
      update: { consent: dto.consent, source: dto.source, updatedById: userId },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-email-preference',
      entityId: contactId,
      after: { consent: dto.consent, source: dto.source },
    });
    if (dto.consent !== CommunicationConsent.GRANTED)
      await this.stopAddress(tenantId, contact.email, 'Consentement retiré');
    return this.preference(tenantId, contactId);
  }

  /** Capability token only. Revocation remains available when the module/tenant is disabled. */
  async unsubscribe(token: string) {
    const pref = await this.prisma.crmEmailPreference.findUnique({
      where: { unsubscribeToken: token },
    });
    if (pref) {
      await this.prisma.crmEmailPreference.updateMany({
        where: { id: pref.id, tenantId: pref.tenantId },
        data: { consent: 'REVOKED', source: 'Désabonnement par lien', updatedById: null },
      });
      await this.stopAddress(pref.tenantId, pref.email, 'Désabonnement');
      await this.audit.log({
        tenantId: pref.tenantId,
        action: AuditAction.UPDATE,
        entityType: 'crm-email-preference',
        entityId: pref.id,
        after: { consent: 'REVOKED', source: 'unsubscribe' },
      });
    }
    return { unsubscribed: true }; // No existence/tenant/contact disclosure.
  }

  private async stopAddress(tenantId: string, email: string, reason: string) {
    const runs = await this.prisma.crmSequenceRun.findMany({
      where: { tenantId, email, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true },
    });
    for (const run of runs)
      await this.transition(tenantId, run.id, undefined, CrmSequenceRunStatus.STOPPED, reason);
  }

  async enroll(tenantId: string, sequenceId: string, contactId: string, userId: string) {
    await this.assertEnabled(tenantId);
    const [sequence, contact] = await Promise.all([
      this.get(tenantId, sequenceId),
      this.contact(tenantId, contactId),
    ]);
    if (!sequence.enabled) throw new BadRequestException('Activez le scénario avant de l’utiliser');
    if (sequence.mode === 'GOVERNED') {
      await this.principal(tenantId, sequence.agentId!);
      const pref = await this.preference(tenantId, contactId);
      if (pref.consent !== 'GRANTED')
        throw new BadRequestException('Consentement courriel explicite requis');
    }
    const steps = sequence.steps as unknown as CrmSequenceStep[];
    const now = new Date();
    const values = { name: contact.name, company: contact.company?.name ?? '' };
    const existing = await this.prisma.crmSequenceRun.findUnique({
      where: { tenantId_sequenceId_contactId: { tenantId, sequenceId, contactId } },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    if (existing) return existing;
    const run = await this.prisma.crmSequenceRun
      .create({
        data: {
          tenantId,
          sequenceId,
          contactId,
          email: contact.email,
          mode: sequence.mode,
          agentId: sequence.agentId,
          createdById: userId,
          steps: {
            create: steps.map((step, position) => ({
              tenantId,
              position,
              delayMinutes: step.delayMinutes,
              subject: renderSequenceText(step.subject, values)
                .replace(/[\r\n]+/g, ' ')
                .slice(0, 200),
              body: renderSequenceText(step.body, values),
              dueAt: position === 0 ? sequenceStepDue(now, step.delayMinutes) : null,
            })),
          },
        },
        include: { steps: { orderBy: { position: 'asc' } } },
      })
      .catch(async (err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return this.prisma.crmSequenceRun.findUniqueOrThrow({
            where: { tenantId_sequenceId_contactId: { tenantId, sequenceId, contactId } },
            include: { steps: { orderBy: { position: 'asc' } } },
          });
        }
        throw err;
      });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-sequence-run',
      entityId: run.id,
      after: { sequenceId, contactId, mode: run.mode },
    });
    return run;
  }

  async onContactCreated(tenantId: string, contactId: string, userId: string) {
    const scenarios = await this.prisma.crmSequence.findMany({
      where: { tenantId, enabled: true, trigger: 'CONTACT_CREATED' },
      take: 50,
    });
    for (const scenario of scenarios) {
      try {
        await this.enroll(tenantId, scenario.id, contactId, userId);
      } catch (err) {
        await this.audit.log({
          tenantId,
          userId,
          action: AuditAction.UPDATE,
          entityType: 'crm-sequence',
          entityId: scenario.id,
          after: { contactId, enrollmentSkipped: (err as Error).message },
        });
      }
    }
  }

  async runs(tenantId: string, query: SequenceRunsQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.sequenceId ? { sequenceId: query.sequenceId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmSequenceRun.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          sequence: { select: { name: true, enabled: true } },
          steps: { orderBy: { position: 'asc' } },
        },
      }),
      this.prisma.crmSequenceRun.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async transition(
    tenantId: string,
    id: string,
    userId: string | undefined,
    to: CrmSequenceRunStatus,
    reason?: string,
  ) {
    const run = await this.prisma.crmSequenceRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Suivi introuvable');
    if (!canTransitionCrmSequenceRun(run.status, to))
      throw new BadRequestException(`Transition ${run.status} → ${to} interdite`);
    const claimed = await this.prisma.crmSequenceRun.updateMany({
      where: { id, tenantId, status: run.status },
      data: { status: to, reason: reason ?? null },
    });
    if (!claimed.count) throw new BadRequestException('Le suivi a changé, rechargez la page');
    if (to === 'STOPPED' || to === 'FAILED') {
      const steps = await this.prisma.crmSequenceStepRun.findMany({
        where: { tenantId, runId: id, status: { in: ['PENDING', 'PROPOSED', 'QUEUED'] } },
      });
      for (const step of steps)
        await this.stepTransition(tenantId, step.id, 'CANCELLED', reason ?? 'Suivi arrêté');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-sequence-run',
      entityId: id,
      before: { status: run.status },
      after: { status: to, reason },
    });
    return { id, status: to };
  }

  private async stepTransition(
    tenantId: string,
    id: string,
    to: string,
    detail?: string,
    extra: { emailId?: string; proposalId?: string } = {},
  ) {
    const step = await this.prisma.crmSequenceStepRun.findFirstOrThrow({ where: { id, tenantId } });
    if (!canTransitionCrmSequenceStep(step.status, to)) return false;
    const changed = await this.prisma.crmSequenceStepRun.updateMany({
      where: { id, tenantId, status: step.status },
      data: { status: to as CrmSequenceStepStatus, detail: detail ?? null, ...extra },
    });
    if (changed.count)
      await this.audit.log({
        tenantId,
        action: AuditAction.UPDATE,
        entityType: 'crm-sequence-step',
        entityId: id,
        before: { status: step.status },
        after: { status: to, detail },
      });
    return changed.count > 0;
  }

  /** Stop conditions are re-read, never inferred from an LLM answer. */
  async deliveryGuard(tenantId: string, stepId: string): Promise<'ALLOW' | 'HOLD' | 'CANCEL'> {
    const step = await this.prisma.crmSequenceStepRun.findFirst({
      where: { id: stepId, tenantId },
      include: stepInclude,
    });
    if (!step || ['CANCELLED', 'FAILED', 'SENT', 'SIMULATED'].includes(step.status))
      return 'CANCEL';
    const run = step.run;
    if (['STOPPED', 'COMPLETED', 'FAILED'].includes(run.status)) return 'CANCEL';
    const contact = await this.prisma.crmContact.findFirst({
      where: { id: run.contactId, tenantId },
      select: { email: true },
    });
    const reply = await this.prisma.emailMessage.findFirst({
      where: {
        tenantId,
        direction: 'INBOUND',
        createdAt: { gte: run.createdAt },
        fromAddress: { equals: run.email, mode: 'insensitive' },
      },
      select: { id: true },
    });
    let reason =
      !contact || contact.email?.trim().toLowerCase() !== run.email
        ? 'Adresse du contact modifiée ou supprimée'
        : reply
          ? 'Réponse reçue : suivi automatique arrêté'
          : '';
    if (!reason && run.mode === 'GOVERNED') {
      const pref = await this.prisma.crmEmailPreference.findUnique({
        where: { tenantId_email: { tenantId, email: run.email } },
      });
      if (pref?.consent !== 'GRANTED') reason = 'Consentement courriel absent ou retiré';
    }
    if (reason) {
      await this.transition(tenantId, run.id, undefined, CrmSequenceRunStatus.STOPPED, reason);
      return 'CANCEL';
    }
    if (run.status === 'PAUSED' || !run.sequence.enabled) return 'HOLD';
    try {
      await this.assertEnabled(tenantId);
      if (run.mode === 'GOVERNED') await this.principal(tenantId, run.agentId!);
    } catch (err) {
      const detail = `Suspendu : ${(err as Error).message}`.slice(0, 500);
      if (step.detail !== detail)
        await this.prisma.crmSequenceStepRun.updateMany({
          where: { id: stepId, tenantId },
          data: { detail },
        });
      return 'HOLD';
    }
    return 'ALLOW';
  }

  /** Handler of the registered sensitive tool; no user-supplied recipient/content. */
  async sendStep(
    tenantId: string,
    stepId: string,
    agentId: string,
    preview: { to: string; subject: string; body: string },
  ) {
    const step = await this.prisma.crmSequenceStepRun.findFirst({
      where: { id: stepId, tenantId },
      include: stepInclude,
    });
    if (!step) throw new NotFoundException('Étape introuvable');
    if (
      preview.to !== step.run.email ||
      preview.subject !== step.subject ||
      preview.body !== step.body
    )
      throw new BadRequestException('Le contenu proposé ne correspond pas à l’étape figée');
    if (step.run.agentId !== agentId || step.run.mode !== 'GOVERNED')
      throw new BadRequestException('Agent non autorisé pour ce suivi');
    await this.principal(tenantId, agentId);
    // Idempotence also protects a repeated AUTO call after a crash before recording its result.
    const old = await this.prisma.emailMessage.findUnique({
      where: { tenantId_dedupKey: { tenantId, dedupKey: `crm-sequence:${stepId}` } },
    });
    if (old) return { emailId: old.id, status: old.status };
    if (!step.dueAt || step.dueAt > new Date() || !['PENDING', 'PROPOSED'].includes(step.status))
      throw new BadRequestException('Cette étape ne peut pas être envoyée');
    if ((await this.deliveryGuard(tenantId, stepId)) !== 'ALLOW')
      throw new BadRequestException('Suivi suspendu ou arrêté');
    const pref = await this.prisma.crmEmailPreference.findUniqueOrThrow({
      where: { tenantId_email: { tenantId, email: step.run.email } },
    });
    const webUrl = this.config.get<string>('WEB_URL', 'http://localhost:5173').replace(/\/$/, '');
    const unsubscribeUrl = `${webUrl}/unsubscribe?token=${pref.unsubscribeToken}`;
    const html = `${sequenceEmailHtml(step.body)}<br><br><a href="${sequenceEmailHtml(unsubscribeUrl)}">Se désabonner de ces suivis</a>`;
    const msg = await this.mail.queue(tenantId, {
      toAddresses: [step.run.email],
      subject: step.subject,
      html,
      text: `${step.body}\n\nSe désabonner : ${unsubscribeUrl}`,
      agentId,
      relatedType: RELATED,
      relatedId: stepId,
      dedupKey: `crm-sequence:${stepId}`,
    });
    await this.stepTransition(
      tenantId,
      stepId,
      'QUEUED',
      'Message mis en file ; livraison non confirmée',
      { emailId: msg.id },
    );
    return { emailId: msg.id, status: msg.status };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // Repair a crash between recording success and scheduling the next step.
      const successes = await this.prisma.crmSequenceStepRun.findMany({
        where: { status: { in: ['SENT', 'SIMULATED'] }, run: { status: 'ACTIVE' } },
        orderBy: { updatedAt: 'asc' },
        take: 100,
        select: { tenantId: true, runId: true, position: true },
      });
      for (const step of successes) {
        await this.advance(step.tenantId, step.runId, step.position);
        await this.prisma.crmSequenceStepRun.updateMany({
          where: { tenantId: step.tenantId, runId: step.runId, position: step.position },
          data: { updatedAt: new Date() },
        });
      }
      const steps = await this.prisma.crmSequenceStepRun.findMany({
        where: {
          status: { in: ['PENDING', 'PROPOSED', 'QUEUED'] },
          dueAt: { lte: new Date() },
          run: { status: 'ACTIVE', sequence: { enabled: true } },
        },
        // Old proposals/paused agents must not monopolize all 50 slots indefinitely.
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: { id: true, tenantId: true },
      });
      for (const step of steps) {
        try {
          // Cross-process exclusion for this step; scope never originates from an HTTP body.
          await this.prisma.$transaction(
            async (tx) => {
              const [lock] = await tx.$queryRaw<
                { locked: boolean }[]
              >`SELECT pg_try_advisory_xact_lock(hashtext(${`crm-sequence:${step.id}`})) AS locked`;
              if (lock.locked) await this.processStep(step.tenantId, step.id);
            },
            { timeout: 20000 },
          );
        } catch (err) {
          this.logger.warn(`Sequence step ${step.id}: ${(err as Error).message}`);
        } finally {
          await this.prisma.crmSequenceStepRun
            .updateMany({
              where: { id: step.id, tenantId: step.tenantId },
              data: { updatedAt: new Date() },
            })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      this.logger.error(`Sequence worker unavailable: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async processStep(tenantId: string, id: string) {
    if ((await this.deliveryGuard(tenantId, id)) !== 'ALLOW') return;
    const step = await this.prisma.crmSequenceStepRun.findFirstOrThrow({
      where: { id, tenantId },
      include: stepInclude,
    });
    if (step.run.mode === 'SIMULATION') {
      await this.stepTransition(tenantId, id, 'SIMULATED', 'Simulation : aucun message envoyé');
      await this.advance(tenantId, step.runId, step.position);
      return;
    }
    const mail = await this.prisma.emailMessage.findUnique({
      where: { tenantId_dedupKey: { tenantId, dedupKey: `crm-sequence:${id}` } },
    });
    if (mail) {
      if (step.status !== 'QUEUED')
        await this.stepTransition(tenantId, id, 'QUEUED', undefined, { emailId: mail.id });
      if (mail.status === 'SENT') {
        await this.stepTransition(
          tenantId,
          id,
          'SENT',
          'Accepté par le transport courriel ; livraison non prouvée',
        );
        await this.advance(tenantId, step.runId, step.position);
      } else if (mail.status === 'FAILED' && !mail.nextAttemptAt) {
        await this.stepTransition(
          tenantId,
          id,
          'FAILED',
          'Échec d’envoi définitif — consulter les courriels',
        );
        await this.transition(
          tenantId,
          step.runId,
          undefined,
          CrmSequenceRunStatus.FAILED,
          'Échec d’envoi',
        );
      }
      return;
    }
    const principal = await this.principal(tenantId, step.run.agentId!);
    const args = { stepId: id, to: step.run.email, subject: step.subject, body: step.body };
    const existing = await this.prisma.proposedAction.findFirst({
      where: {
        tenantId,
        agentId: principal.agentId,
        idempotencyKey: deriveIdempotencyKey(TOOL, args),
      },
    });
    if (existing) {
      if (['REJECTED', 'FAILED'].includes(existing.status)) {
        await this.stepTransition(tenantId, id, 'FAILED', 'Action refusée ou échouée');
        await this.transition(
          tenantId,
          step.runId,
          undefined,
          CrmSequenceRunStatus.FAILED,
          'Action refusée ou échouée',
        );
      } else if (existing.status === 'PENDING') {
        await this.stepTransition(tenantId, id, 'PROPOSED', 'En attente d’approbation', {
          proposalId: existing.id,
        });
      }
      return;
    }
    principal.triggeredByRef = `crm-sequence:${step.runId}`;
    const governance = this.modules.get<ProposedActionsService>(
      require('../../core/agents/proposed-actions.service').ProposedActionsService,
      { strict: false },
    );
    const decision = await governance.handleMutatingTool(
      principal,
      TOOL_BY_NAME.get(TOOL)!,
      args,
      this.modules.get<ToolServices>(AGENT_TOOL_SERVICES, { strict: false }),
    );
    if (decision.effect === 'DENY') {
      await this.stepTransition(tenantId, id, 'FAILED', 'Envoi refusé par la politique de l’agent');
      await this.transition(
        tenantId,
        step.runId,
        undefined,
        CrmSequenceRunStatus.FAILED,
        'Politique de l’agent',
      );
    } else if (decision.proposalId)
      await this.stepTransition(tenantId, id, 'PROPOSED', 'En attente d’approbation', {
        proposalId: decision.proposalId,
      });
  }

  private async advance(tenantId: string, runId: string, position: number) {
    const next = await this.prisma.crmSequenceStepRun.findFirst({
      where: { tenantId, runId, position: position + 1 },
    });
    if (next)
      await this.prisma.crmSequenceStepRun.updateMany({
        where: { id: next.id, tenantId, dueAt: null, status: 'PENDING' },
        data: { dueAt: sequenceStepDue(new Date(), next.delayMinutes) },
      });
    else {
      const run = await this.prisma.crmSequenceRun.findFirst({ where: { id: runId, tenantId } });
      if (run?.status === 'ACTIVE')
        await this.transition(tenantId, runId, undefined, CrmSequenceRunStatus.COMPLETED);
    }
  }
}
