export type IntegrationKind =
  | 'erp'
  | 'accounting'
  | 'telematics'
  | 'edi'
  | 'warehouse'
  | 'webhook'
  | 'custom';

export type IntegrationConnectorStatus = 'DISABLED' | 'ENABLED' | 'ERROR';
export type IntegrationHealthState = 'not_configured' | 'ready' | 'live' | 'degraded' | 'blocked';
export type IntegrationSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface IntegrationDeliveryStats {
  last24h: number;
  failedLast24h: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
}

export interface IntegrationOperationsInput {
  key: string;
  name: string;
  kind?: IntegrationKind;
  status: IntegrationConnectorStatus;
  capabilities?: string[];
  requiredCapabilities?: string[];
  deliveryStats?: IntegrationDeliveryStats;
  owner?: string;
}

export interface IntegrationHealth {
  state: IntegrationHealthState;
  severity: IntegrationSeverity;
  reason: string;
  nextStep: string;
  failureRatePct: number | null;
  missingCapabilities: string[];
}

export interface IntegrationReadinessRow {
  key: string;
  name: string;
  kind: IntegrationKind;
  status: IntegrationConnectorStatus;
  health: IntegrationHealth;
}

export interface IntegrationReadinessSummary {
  total: number;
  live: number;
  degraded: number;
  blocked: number;
  notConfigured: number;
  attention: IntegrationReadinessRow[];
  rows: IntegrationReadinessRow[];
}

export interface IntegrationRoadmapPhase {
  phase: 'foundation' | 'visibility' | 'automation';
  title: string;
  outcome: string;
  connectors: Array<Pick<IntegrationOperationsInput, 'key' | 'name' | 'kind' | 'status'>>;
}

const DEFAULT_KIND: IntegrationKind = 'custom';

const KIND_PATTERNS: Array<[IntegrationKind, RegExp]> = [
  ['erp', /\b(erp|odoo|sap|netsuite|dynamics)\b/i],
  ['accounting', /\b(accounting|quickbooks|xero|sage|invoice|payment)\b/i],
  ['telematics', /\b(telematics|samsara|geotab|gps|eld|position)\b/i],
  ['edi', /\b(edi|204|210|214|990|x12)\b/i],
  ['warehouse', /\b(warehouse|wms|inventory)\b/i],
  ['webhook', /\b(webhook|hook|callback)\b/i],
];

export function inferIntegrationKind(key: string, name = ''): IntegrationKind {
  const haystack = `${key} ${name}`;
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(haystack))?.[0] ?? DEFAULT_KIND;
}

const severityRank: Record<IntegrationSeverity, number> = {
  critical: 1000,
  warning: 700,
  info: 300,
  ok: 0,
};

function roundPct(value: number): number {
  return Math.round(value * 1000) / 10;
}

function missingCapabilities(input: IntegrationOperationsInput): string[] {
  const available = new Set(input.capabilities ?? []);
  return (input.requiredCapabilities ?? []).filter((capability) => !available.has(capability));
}

export function computeIntegrationHealth(input: IntegrationOperationsInput): IntegrationHealth {
  const missing = missingCapabilities(input);
  const stats = input.deliveryStats;
  const failureRatePct = stats && stats.last24h > 0 ? roundPct(stats.failedLast24h / stats.last24h) : null;

  if (missing.length > 0 && input.status === 'ENABLED') {
    return {
      state: 'blocked',
      severity: 'critical',
      reason: `Capacités requises manquantes: ${missing.join(', ')}`,
      nextStep: 'Compléter le mapping et les permissions avant de brancher cette intégration aux opérations.',
      failureRatePct,
      missingCapabilities: missing,
    };
  }

  if (input.status === 'ERROR') {
    return {
      state: 'degraded',
      severity: 'warning',
      reason: 'Connecteur en erreur',
      nextStep: 'Inspecter les dernières livraisons échouées, corriger les credentials ou désactiver le flux.',
      failureRatePct,
      missingCapabilities: missing,
    };
  }

  if (failureRatePct !== null && failureRatePct >= 20) {
    return {
      state: 'degraded',
      severity: 'warning',
      reason: `${failureRatePct}% des livraisons ont échoué sur 24h`,
      nextStep: 'Ouvrir les livraisons échouées et isoler le payload, le mapping ou le endpoint fautif.',
      failureRatePct,
      missingCapabilities: missing,
    };
  }

  if (input.status === 'DISABLED') {
    return {
      state: 'not_configured',
      severity: 'info',
      reason: missing.length > 0 ? `À configurer: ${missing.join(', ')}` : 'Connecteur désactivé',
      nextStep: 'Définir le propriétaire, les capacités attendues, les credentials et un premier test sandbox.',
      failureRatePct,
      missingCapabilities: missing,
    };
  }

  if (stats?.lastSuccessAt) {
    return {
      state: 'live',
      severity: 'ok',
      reason: 'Synchronisation active',
      nextStep: 'Surveiller le taux d’échec, la fraîcheur des données et les impacts sur les agents.',
      failureRatePct,
      missingCapabilities: missing,
    };
  }

  return {
    state: 'ready',
    severity: 'info',
    reason: 'Prêt pour un premier échange contrôlé',
    nextStep: 'Lancer un test manuel avec evidence avant de permettre une automatisation.',
    failureRatePct,
    missingCapabilities: missing,
  };
}

export function integrationAttentionRank(health: IntegrationHealth): number {
  const stateBoost: Record<IntegrationHealthState, number> = {
    blocked: 80,
    degraded: 60,
    not_configured: 30,
    ready: 10,
    live: 0,
  };
  return severityRank[health.severity] + stateBoost[health.state];
}

export function summarizeIntegrationReadiness(
  integrations: IntegrationOperationsInput[],
): IntegrationReadinessSummary {
  const rows = integrations.map((integration) => ({
    key: integration.key,
    name: integration.name,
    kind: integration.kind ?? DEFAULT_KIND,
    status: integration.status,
    health: computeIntegrationHealth(integration),
  }));

  const attention = rows
    .filter((row) => row.health.state !== 'live')
    .sort((a, b) => integrationAttentionRank(b.health) - integrationAttentionRank(a.health));

  return {
    total: rows.length,
    live: rows.filter((row) => row.health.state === 'live').length,
    degraded: rows.filter((row) => row.health.state === 'degraded').length,
    blocked: rows.filter((row) => row.health.state === 'blocked').length,
    notConfigured: rows.filter((row) => row.health.state === 'not_configured').length,
    attention,
    rows,
  };
}

export function buildIntegrationRoadmap(
  connectors: IntegrationOperationsInput[],
): IntegrationRoadmapPhase[] {
  const byKind = (kinds: IntegrationKind[]) =>
    connectors
      .filter((connector) => kinds.includes(connector.kind ?? DEFAULT_KIND))
      .map((connector) => ({
        key: connector.key,
        name: connector.name,
        kind: connector.kind ?? DEFAULT_KIND,
        status: connector.status,
      }));

  return [
    {
      phase: 'foundation',
      title: 'Système de vérité',
      outcome: 'Brancher ERP/comptabilité pour que Pulsar connaisse clients, commandes, coûts et factures.',
      connectors: byKind(['erp', 'accounting']),
    },
    {
      phase: 'visibility',
      title: 'Visibilité opérationnelle',
      outcome: 'Importer statuts, positions et événements EDI/webhook pour réduire les exceptions manuelles.',
      connectors: byKind(['telematics', 'edi', 'webhook']),
    },
    {
      phase: 'automation',
      title: 'Automatisation gouvernée',
      outcome: 'Permettre aux agents Hermes d’automatiser les actions low-risk avec preuves, politiques et rollback.',
      connectors: byKind(['warehouse', 'custom']),
    },
  ];
}
