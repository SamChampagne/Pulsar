import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getRuntimeProvider, RUNTIME_PROVIDERS } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailConfigService } from '../email/email-config.service';
import {
  PlatformEmailConfigService,
  type PlatformActor,
} from '../email/platform-email-config.service';
import { RuntimeConfigService } from '../agents/runtime-config.service';
import { RuntimeHealthService } from '../agents/runtime-health.service';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { PlatformRuntimeDto, PlatformSmtpDto, ServiceChangeDto } from './dto/platform-services.dto';

/** Cross-tenant control plane, only reachable behind PlatformGuard. No business data or impersonation. */
@Injectable()
export class PlatformServicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly email: EmailService,
    private readonly smtp: PlatformEmailConfigService,
    private readonly tenantEmail: EmailConfigService,
    private readonly config: RuntimeConfigService,
    private readonly health: RuntimeHealthService,
    private readonly modules: ModuleRef,
  ) {}
  private runtime() {
    return this.modules.get(AgentRuntimeService, { strict: false });
  }
  async tenant(id: string, write = false) {
    const tenant = await this.db.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Entreprise introuvable.');
    if (write && tenant.status !== 'ACTIVE')
      throw new BadRequestException('Réactivez cette entreprise avant de modifier ses connexions.');
    return tenant;
  }
  async overview() {
    const [email, tenants, audit] = await Promise.all([
      this.smtp.get(),
      this.db.tenant.findMany({
        select: { id: true, name: true, slug: true, status: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.db.platformServiceAudit.findMany({
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          service: true,
          action: true,
          createdAt: true,
          actor: { select: { email: true } },
        },
      }),
    ]);
    let emailChannel: 'smtp' | 'log' | 'unavailable' = 'unavailable';
    try {
      emailChannel = await this.email.effectiveChannel();
    } catch {
      /* Never expose secrets or claim simulation on error. */
    }
    return { email, emailChannel, tenants, providers: RUNTIME_PROVIDERS, audit, tenantLimit: 500 };
  }
  async detail(id: string) {
    const tenant = await this.tenant(id);
    const [runtime, health, email, sms] = await Promise.all([
      this.config.get(id),
      this.health.inspect(id),
      this.tenantEmail.connectionStatus(id),
      this.db.tenantSmsConfig.findUnique({
        where: { tenantId: id },
        select: { active: true, liveAuthorized: true, lastWebhookAt: true },
      }),
    ]);
    return { tenant, runtime: this.config.project(runtime), health, email, sms };
  }
  async saveRuntime(actor: PlatformActor, id: string, dto: PlatformRuntimeDto) {
    await this.tenant(id, true);
    const provider = getRuntimeProvider(dto.provider);
    if (!provider || !dto.confirmed)
      throw new BadRequestException('Confirmez le fournisseur et l’entreprise.');
    return this.config.project(
      await this.config.upsert(
        id,
        {
          provider: dto.provider,
          authMode: provider.authMode,
          apiKey: dto.apiKey,
          defaultModel: dto.defaultModel || null,
          baseUrl: dto.baseUrl || null,
        },
        { actorId: actor.id, expectedUpdatedAt: dto.expectedUpdatedAt },
      ),
    );
  }
  async saveEmail(actor: PlatformActor, id: string, dto: PlatformSmtpDto) {
    await this.tenant(id, true);
    if (!dto.confirmed || dto.mode === 'SIMULATION')
      throw new BadRequestException('Choisissez SMTP entreprise ou héritage plateforme.');
    const old = await this.tenantEmail.get(id);
    const changed = old?.host !== (dto.host || null) || old?.username !== (dto.username || null);
    if (
      dto.mode === 'SMTP' &&
      (!dto.host ||
        !dto.fromEmail ||
        (dto.username && !dto.password && (changed || !old?.hasPassword)))
    )
      throw new BadRequestException('SMTP exige hôte, expéditeur et secret du compte.');
    return this.tenantEmail.upsert(
      id,
      {
        expectedUpdatedAt: dto.expectedUpdatedAt,
        active: dto.mode === 'SMTP',
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        username: dto.username,
        fromName: dto.fromName,
        fromEmail: dto.fromEmail,
        replyTo: dto.replyTo,
        ...(dto.password ? { password: dto.password } : {}),
      },
      undefined,
      actor,
    );
  }
  async verifyEmail(actor: PlatformActor, dto: ServiceChangeDto, id?: string) {
    if (id) await this.tenant(id, true);
    const version = id
      ? ((await this.tenantEmail.get(id))?.updatedAt.toISOString() ?? null)
      : (await this.smtp.get()).updatedAt;
    if (!dto.confirmed || version !== dto.expectedUpdatedAt)
      throw new ConflictException('Rechargez et confirmez la configuration à vérifier.');
    const transport = id ? await this.tenantEmail.resolve(id) : await this.email.captureTransport();
    if (id && !transport)
      return {
        ok: false,
        code: 'INHERITED',
        message:
          'Cette entreprise hérite du transport plateforme. Vérifiez-le dans Courriel plateforme; aucun serveur contacté ici.',
      };
    const result = await this.smtp.verify(actor, transport, id);
    if (!id && version)
      await this.db.platformEmailConfig.updateMany({
        where: { id: 'smtp', updatedAt: new Date(version) },
        data: { lastTestAt: new Date(), lastTestOk: result.ok, updatedAt: new Date(version) },
      });
    return result;
  }
  async authorizeRuntimeAction(
    actor: PlatformActor,
    id: string,
    dto: ServiceChangeDto,
    action: string,
  ) {
    await this.tenant(id, true);
    const row = await this.config.get(id);
    if (!dto.confirmed || (row?.updatedAt.toISOString() ?? null) !== dto.expectedUpdatedAt)
      throw new ConflictException('Rechargez et confirmez la connexion IA.');
    await this.db.platformServiceAudit.create({
      data: { actorId: actor.id, tenantId: id, service: 'tenant-ai', action, detail: {} },
    });
  }
  async testRuntime(actor: PlatformActor, id: string, dto: ServiceChangeDto) {
    await this.authorizeRuntimeAction(actor, id, dto, 'VERIFY_RUNTIME');
    const result = await this.runtime().testConnection(id);
    return {
      ok: result.ok,
      scope: 'RUNTIME_ONLY',
      message: result.ok
        ? 'Protocole runtime vérifié. Aucun appel LLM effectué.'
        : 'Échec runtime. Vérifiez le rattachement, la disponibilité et la connexion fournisseur.',
    };
  }
  async *connectRuntime(id: string, signal: AbortSignal) {
    yield* this.runtime().connectLogin(id, signal);
  }
}
