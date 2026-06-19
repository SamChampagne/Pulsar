import { Injectable } from '@nestjs/common';
import { MODULE_KEYS } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

export interface OnboardingStep {
  key: 'modules' | 'users' | 'runtime' | 'agents' | 'master-data' | 'operations' | 'branding';
  label: string;
  description: string;
  done: boolean;
  detail?: string;
  href: string;
}

export interface OnboardingStatusDto {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  percent: number;
}

/**
 * Read-only aggregation of a tenant's onboarding/configuration state. Computes a
 * checklist from the live state (counts, runtime config, branding) and points the
 * admin at the existing page that completes each step. Core feature: no module gate,
 * tenant-scoped (rule 1), zero writes.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  async getStatus(tenantId: string): Promise<OnboardingStatusDto> {
    const [
      enabledKeys,
      activeUsers,
      runtime,
      agents,
      customers,
      locations,
      carriers,
      transportOrders,
      loads,
      tenant,
    ] = await Promise.all([
      this.modulesCache.getEnabledKeys(tenantId),
      this.prisma.user.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.agentRuntimeConfig.findUnique({
        where: { tenantId },
        select: { connectedAt: true, lastTestOk: true },
      }),
      this.prisma.agent.count({ where: { tenantId, status: { not: 'REVOKED' } } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.location.count({ where: { tenantId } }),
      this.prisma.carrier.count({ where: { tenantId } }),
      this.prisma.transportOrder.count({ where: { tenantId } }),
      this.prisma.load.count({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    ]);

    // Enabled non-core business modules (core is implicit/isCore, never in the enabled set).
    const businessModules = [...enabledKeys].filter((k) => k !== MODULE_KEYS.CORE).length;

    const runtimeReady = !!runtime && (runtime.connectedAt !== null || runtime.lastTestOk === true);

    const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
    const branding = (settings.branding as Record<string, unknown> | undefined) ?? undefined;
    const brandingDone = !!branding && (!!branding.logoUrl || !!branding.accentColor);

    const masterDataDone = customers > 0 || locations > 0 || carriers > 0;
    const operationsDone = transportOrders > 0 || loads > 0;

    const steps: OnboardingStep[] = [
      {
        key: 'modules',
        label: 'Activer des modules',
        description: 'Activez au moins un module métier pour votre organisation.',
        done: businessModules >= 1,
        detail: `${businessModules} module${businessModules > 1 ? 's' : ''} activé${businessModules > 1 ? 's' : ''}`,
        href: '/settings/modules',
      },
      {
        key: 'users',
        label: 'Inviter votre équipe',
        description: 'Invitez au moins un collègue en plus de votre compte administrateur.',
        done: activeUsers >= 2,
        detail: `${activeUsers} utilisateur${activeUsers > 1 ? 's' : ''} actif${activeUsers > 1 ? 's' : ''}`,
        href: '/settings/users',
      },
      {
        key: 'runtime',
        label: 'Connecter le runtime IA',
        description: 'Configurez le fournisseur LLM pour activer vos agents.',
        done: runtimeReady,
        detail: runtimeReady ? 'Runtime connecté' : 'Non configuré',
        href: '/settings/agent-runtime',
      },
      {
        key: 'agents',
        label: 'Créer un agent',
        description: 'Créez au moins un agent-employé pour automatiser vos opérations.',
        done: agents >= 1,
        detail: `${agents} agent${agents > 1 ? 's' : ''}`,
        href: '/agents',
      },
      {
        key: 'master-data',
        label: 'Ajouter vos données de base',
        description: 'Renseignez vos clients, lieux et transporteurs.',
        done: masterDataDone,
        detail: `${customers} client${customers > 1 ? 's' : ''} · ${locations} lieu${locations > 1 ? 'x' : ''} · ${carriers} transporteur${carriers > 1 ? 's' : ''}`,
        href: '/customers',
      },
      {
        key: 'operations',
        label: 'Lancer vos opérations',
        description: 'Créez votre première commande de transport ou votre premier load.',
        done: operationsDone,
        detail: `${transportOrders} commande${transportOrders > 1 ? 's' : ''} · ${loads} load${loads > 1 ? 's' : ''}`,
        href: '/dispatch',
      },
      {
        key: 'branding',
        label: 'Personnaliser votre marque',
        description: 'Ajoutez votre logo ou une couleur d’accent pour le portail client.',
        done: brandingDone,
        detail: brandingDone ? 'Branding configuré' : 'Aucun branding',
        href: '/customers',
      },
    ];

    const total = steps.length;
    const completed = steps.filter((s) => s.done).length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    return { steps, completed, total, percent };
  }
}
