import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  deriveQueueState,
  type PlatformOperations,
  type PlatformTenantDiagnostics,
  type QueueObservation,
  type ServiceObservation,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ApsRuntimeService } from '../aps/aps-runtime.service';
import { isInstalled } from '../agents/runtime-install';
import { DeploymentObservationService, unknownMigrations } from './deployment-observation.service';
import { EmailService } from '../email/email.service';

/** Platform-plane observations only. No tenant content, credentials or raw errors. */
@Injectable()
export class PlatformOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aps: ApsRuntimeService,
    private readonly deployment: DeploymentObservationService,
    private readonly emailService: EmailService,
  ) {}

  private async bounded<T>(work: Promise<T>, ms = 5000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Observation timeout')), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async overview(): Promise<PlatformOperations> {
    const checkedAt = new Date().toISOString();
    const observation = (
      key: string,
      label: string,
      state: ServiceObservation['state'],
      detail: string,
      nextAction: string,
    ): ServiceObservation => ({ key, label, state, detail, nextAction, checkedAt });
    const start = Date.now();
    const [db, aps, queues, tenants, migrations] = await Promise.allSettled([
      this.bounded(this.prisma.$queryRaw`SELECT 1`.then(() => Date.now() - start)),
      this.bounded(this.aps.status()),
      this.bounded(this.queues()),
      this.bounded(this.tenantCounts()),
      this.bounded(this.deployment.migrations()),
    ]);
    const services: ServiceObservation[] = [
      observation(
        'api',
        'API Pulsar',
        'OPERATIONAL',
        'Cette requête authentifiée a été traitée.',
        'Consulter les files et les dépendances ci-dessous.',
      ),
      {
        ...observation(
          'postgres',
          'Base Pulsar',
          db.status === 'fulfilled' ? 'OPERATIONAL' : 'UNAVAILABLE',
          db.status === 'fulfilled'
            ? 'Connexion PostgreSQL vérifiée. Ce test ne valide pas une sauvegarde.'
            : 'La base ne répond pas dans le délai de diagnostic.',
          db.status === 'fulfilled'
            ? 'Surveiller le volume et tester la restauration.'
            : 'Vérifier PostgreSQL et la configuration de connexion.',
        ),
        ...(db.status === 'fulfilled' ? { latencyMs: db.value } : {}),
      },
    ];
    const engine = aps.status === 'fulfilled' ? aps.value : null;
    services.push(
      observation(
        'aps',
        'Planification APS',
        !engine
          ? 'UNAVAILABLE'
          : !engine.installed && !engine.healthy
            ? 'NOT_CONFIGURED'
            : !engine.healthy
              ? 'UNAVAILABLE'
              : !engine.dbReady
                ? 'DEGRADED'
                : 'OPERATIONAL',
        !engine
          ? 'Diagnostic du moteur indisponible.'
          : !engine.healthy
            ? 'Le moteur ne répond pas ou n’est pas installé.'
            : !engine.dbReady
              ? 'Le processus répond, mais sa base n’est pas prête.'
              : 'Le moteur répond et déclare sa base prête. Aucun calcul lancé par ce diagnostic.',
        'Vérifier le déploiement APS et ses migrations avant de planifier.',
      ),
    );
    let installed = false;
    try {
      installed = isInstalled();
    } catch {
      /* Absence is diagnostic, not a core failure. */
    }
    services.push(
      observation(
        'agents',
        'Runtime agents',
        process.env.AGENT_RUNTIME_MODE === 'remote' || installed ? 'UNVERIFIED' : 'NOT_CONFIGURED',
        process.env.AGENT_RUNTIME_MODE === 'remote'
          ? 'Mode distant actif. Le rattachement et la disponibilité des runners sont à vérifier dans Services et connexions; ce statut ne prouve pas leur présence.'
          : installed
            ? 'Runtime installé. Les identifiants, modèles et connexions restent propres à chaque entreprise.'
            : 'Runtime Hermes non installé sur ce processus API.',
        'Ouvrir Administration > Services et connexions, puis sélectionner une entreprise pour vérifier son runner et configurer son fournisseur. Aucun appel LLM effectué ici.',
      ),
    );
    const email = await this.emailService.effectiveChannel().catch(() => 'unavailable');
    services.push(
      observation(
        'email',
        'Courriels sortants',
        email === 'unavailable' ? 'UNAVAILABLE' : email === 'log' ? 'NOT_CONFIGURED' : 'UNVERIFIED',
        email === 'log'
          ? 'Pilote global log : les courriels globaux ne sont pas livrés. Des réglages par entreprise peuvent différer.'
          : email === 'unavailable'
            ? 'Configuration du transport global indisponible. Aucun repli simulé supposé.'
            : 'SMTP global configuré. La livraison réelle n’a pas été testée.',
        'Ouvrir Administration > Services et connexions pour configurer le SMTP global ou celui d’une entreprise et vérifier la connexion sans envoyer.',
      ),
    );
    const storage = this.config.get<string>('STORAGE_DRIVER', 'local');
    services.push(
      observation(
        'storage',
        'Documents',
        storage === 'local' ? 'DEGRADED' : 'UNVERIFIED',
        storage === 'local'
          ? 'Stockage local : la persistance dépend du volume monté. Aucune écriture de test effectuée.'
          : 'Stockage distant configuré, accès et persistance non vérifiés par cette sonde.',
        'Vérifier le volume ou le stockage S3 et tester le cycle dépôt/téléchargement.',
      ),
    );
    services.push(
      observation(
        'backup',
        'Sauvegarde et restauration',
        'UNVERIFIED',
        'Aucune preuve de restauration n’est collectée par Pulsar.',
        'Exécuter le protocole de sauvegarde/restauration du runbook et conserver la preuve.',
      ),
    );
    const label = (key: string, fallback: string) => {
      const value = this.config.get<string>(key, fallback);
      return /^[a-zA-Z0-9._ /-]{1,80}$/.test(value) ? value : fallback;
    };
    return {
      checkedAt,
      deploymentChecks: {
        migrations: migrations.status === 'fulfilled' ? migrations.value : unknownMigrations(),
        platformMfaEnforced: this.config.get('PLATFORM_MFA_ENFORCED') === 'true',
      },
      environment: {
        name: label('PULSAR_ENVIRONMENT', 'local'),
        version: label('PULSAR_BUILD_VERSION', 'non renseignée'),
        uptimeSeconds: Math.floor(process.uptime()),
        deployment: 'API mono-instance',
      },
      services,
      queues: queues.status === 'fulfilled' ? queues.value : [],
      queuesAvailable: queues.status === 'fulfilled',
      tenants: tenants.status === 'fulfilled' ? tenants.value : null,
      limits: [
        'Les files affichent des enregistrements durables, pas une sonde de chaque cron.',
        'Les échecs conservés ne prouvent pas une panne en cours. Examiner leur ancienneté.',
        'Les événements internes restent best-effort et la file des agents reste en mémoire.',
        'Aucun email, appel IA ni traitement métier n’est déclenché par Actualiser.',
      ],
    };
  }

  private async tenantCounts() {
    const [total, active, suspended, runtimeConfigured, agents] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.agentRuntimeConfig.count(),
      this.prisma.agent.count(),
    ]);
    return { total, active, suspended, runtimeConfigured, agents };
  }

  async tenant(id: string): Promise<PlatformTenantDiagnostics> {
    const row = await this.bounded(
      this.prisma.tenant.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          modules: { where: { enabled: true }, select: { module: { select: { key: true } } } },
          _count: { select: { users: true, agents: true, integrations: true } },
          agentRuntimeConfig: { select: { lastTestAt: true, lastTestOk: true } },
        },
      }),
    );
    if (!row) throw new NotFoundException('Entreprise introuvable');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      modules: row.modules.map((m) => m.module.key),
      ...row._count,
      runtime: {
        configured: !!row.agentRuntimeConfig,
        lastTestAt: row.agentRuntimeConfig?.lastTestAt?.toISOString() ?? null,
        lastTestOk: row.agentRuntimeConfig?.lastTestOk ?? null,
      },
      queues: await this.bounded(this.queues(id)),
      checkedAt: new Date().toISOString(),
    };
  }

  private async queues(tenantId?: string): Promise<QueueObservation[]> {
    // No tenantId only on the platform-wide diagnostic, behind PlatformGuard.
    const where = tenantId ? { tenantId } : {};
    const [events, runs, actions, webhooks, emails] = await Promise.all([
      this.prisma.domainEvent.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.agentRun.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.proposedAction.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _min: { proposedAt: true },
        _max: { proposedAt: true },
      }),
      this.prisma.webhookDelivery.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.emailMessage.groupBy({
        by: ['status'],
        where: { ...where, direction: 'OUTBOUND' },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);
    type Row = {
      status: string;
      _count: { _all: number };
      _min: { createdAt?: Date | null; proposedAt?: Date | null };
      _max: { createdAt?: Date | null; proposedAt?: Date | null };
    };
    const summarize = (
      key: string,
      label: string,
      rows: Row[],
      pendingStates: string[],
    ): QueueObservation => {
      const pendingRows = rows.filter((r) => pendingStates.includes(r.status));
      const pending = pendingRows.reduce((n, r) => n + r._count._all, 0);
      const failed = rows
        .filter((r) => r.status === 'FAILED')
        .reduce((n, r) => n + r._count._all, 0);
      const first = pendingRows
        .flatMap((r) => r._min.createdAt ?? r._min.proposedAt ?? [])
        .sort((a, b) => +a - +b)[0];
      const last = rows
        .flatMap((r) => r._max.createdAt ?? r._max.proposedAt ?? [])
        .sort((a, b) => +b - +a)[0];
      const oldestPendingAt = first?.toISOString() ?? null;
      const lastActivityAt = last?.toISOString() ?? null;
      return {
        key,
        label,
        pending,
        failed,
        oldestPendingAt,
        lastActivityAt,
        state: deriveQueueState(pending, failed, oldestPendingAt, lastActivityAt, Date.now()),
        detail:
          'Échecs conservés, toutes dates. Dernière activité = dernier enregistrement créé, pas dernière exécution du worker.',
      };
    };
    return [
      summarize('events', 'Événements métier', events, ['PENDING']),
      summarize('runs', 'Exécutions agents', runs, ['QUEUED', 'RUNNING']),
      summarize('actions', 'Décisions agents', actions, ['PENDING', 'APPROVED']),
      summarize('webhooks', 'Webhooks sortants', webhooks, ['PENDING']),
      summarize('emails', 'Courriels sortants', emails, ['QUEUED', 'SENDING']),
    ];
  }
}
