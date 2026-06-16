import type { IntegrationConnectorStatus, IntegrationHealthState, IntegrationKind } from './operations';

export type IntegrationProviderKey =
  | 'odoo'
  | 'quickbooks'
  | 'warehouse-wms'
  | 'custom-api'
  | 'webhook'
  | 'csv-import';

export type IntegrationConnectionMode = 'oauth' | 'api_key' | 'basic_auth' | 'webhook' | 'file_import';
export type IntegrationCapabilityRisk = 'read' | 'low_write' | 'controlled_write' | 'sensitive_write';
export type IntegrationAgentApprovalPolicy = 'propose' | 'auto_low_risk' | 'auto_controlled';

export type IntegrationCapabilityKey =
  | 'customers.read'
  | 'customers.write'
  | 'orders.read'
  | 'orders.write'
  | 'shipments.read'
  | 'shipments.write'
  | 'invoices.read'
  | 'invoices.write'
  | 'payments.read'
  | 'payments.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'receiving.read'
  | 'receiving.write'
  | 'picking.read'
  | 'picking.write'
  | 'webhooks.receive'
  | 'files.import';

export interface ConnectorProviderBlueprint {
  key: IntegrationProviderKey;
  name: string;
  kind: IntegrationKind;
  connectionModes: IntegrationConnectionMode[];
  /** Read-first initial scope offered during safe onboarding. Writes must be explicitly enabled. */
  defaultCapabilities: IntegrationCapabilityKey[];
  /** Full capability vocabulary the provider may support after policy/approval configuration. */
  supportedCapabilities: IntegrationCapabilityKey[];
  recommendedFirstSync: IntegrationCapabilityKey[];
  notes: string;
}

export interface IntegrationAgentAccessContext {
  connectorStatus: IntegrationConnectorStatus;
  healthState: IntegrationHealthState;
  requestedCapability: IntegrationCapabilityKey;
  connectorCapabilities: IntegrationCapabilityKey[];
  agentAllowedCapabilities: IntegrationCapabilityKey[];
  approvalPolicy: IntegrationAgentApprovalPolicy;
}

export type IntegrationAgentAccessDenyReason =
  | 'connector_not_live'
  | 'capability_missing'
  | 'agent_not_allowed'
  | 'approval_required';

export type IntegrationAgentAccessResult =
  | { allowed: true; reason: 'allowed'; approvalRequired: false }
  | { allowed: false; reason: IntegrationAgentAccessDenyReason; approvalRequired: boolean };

export interface ConnectorFoundationInput {
  providerKey: IntegrationProviderKey;
  enabledCapabilities: IntegrationCapabilityKey[];
  mappedCapabilities: IntegrationCapabilityKey[];
  testedCapabilities: IntegrationCapabilityKey[];
  owner?: string | null;
}

export type ConnectorFoundationStage = 'owner' | 'capabilities' | 'mapping' | 'sandbox' | 'ready';

export interface ConnectorFoundationSummary {
  provider: ConnectorProviderBlueprint | undefined;
  stage: ConnectorFoundationStage;
  missingMapping: IntegrationCapabilityKey[];
  missingTests: IntegrationCapabilityKey[];
  nextAction: string;
}

export interface ConnectorOnboardingStep {
  key:
    | 'select-provider'
    | 'authenticate'
    | 'choose-capabilities'
    | 'map-fields'
    | 'run-sandbox-test'
    | 'activate-with-monitoring';
  title: string;
  description: string;
  evidenceRequired: boolean;
  agentGate?: string;
}

export const CONNECTOR_PROVIDER_BLUEPRINTS: ConnectorProviderBlueprint[] = [
  {
    key: 'odoo',
    name: 'Odoo ERP',
    kind: 'erp',
    connectionModes: ['api_key', 'basic_auth'],
    defaultCapabilities: ['customers.read', 'orders.read', 'invoices.read', 'inventory.read'],
    supportedCapabilities: ['customers.read', 'customers.write', 'orders.read', 'orders.write', 'invoices.read', 'inventory.read'],
    recommendedFirstSync: ['customers.read', 'orders.read'],
    notes: 'Premier connecteur ERP cible: source de vérité pour clients, commandes, factures et inventaire léger.',
  },
  {
    key: 'quickbooks',
    name: 'QuickBooks',
    kind: 'accounting',
    connectionModes: ['oauth'],
    defaultCapabilities: ['customers.read', 'invoices.read', 'payments.read'],
    supportedCapabilities: ['customers.read', 'invoices.read', 'invoices.write', 'payments.read', 'payments.write'],
    recommendedFirstSync: ['customers.read', 'invoices.read', 'payments.read'],
    notes: 'Comptabilité: commencer read-only, puis proposer les écritures de factures via ProposedAction.',
  },
  {
    key: 'warehouse-wms',
    name: 'Warehouse / WMS',
    kind: 'warehouse',
    connectionModes: ['api_key', 'webhook'],
    defaultCapabilities: ['inventory.read', 'receiving.read', 'picking.read'],
    supportedCapabilities: [
      'inventory.read',
      'inventory.write',
      'receiving.read',
      'receiving.write',
      'picking.read',
      'picking.write',
    ],
    recommendedFirstSync: ['inventory.read', 'receiving.read', 'picking.read'],
    notes: 'Pont vers Light WMS: lire inventaire/receiving/picking avant toute écriture de préparation.',
  },
  {
    key: 'custom-api',
    name: 'Custom API',
    kind: 'custom',
    connectionModes: ['api_key', 'oauth'],
    defaultCapabilities: ['customers.read', 'orders.read', 'shipments.read'],
    supportedCapabilities: ['customers.read', 'customers.write', 'orders.read', 'orders.write', 'shipments.read', 'shipments.write'],
    recommendedFirstSync: ['customers.read', 'orders.read'],
    notes: 'Connecteur contrôlé pour logiciels clients custom; mapping explicite obligatoire.',
  },
  {
    key: 'webhook',
    name: 'Inbound Webhook',
    kind: 'webhook',
    connectionModes: ['webhook'],
    defaultCapabilities: ['webhooks.receive', 'shipments.read'],
    supportedCapabilities: ['webhooks.receive', 'shipments.read'],
    recommendedFirstSync: ['webhooks.receive'],
    notes: 'Canal temps réel; toujours doublé par pull/reconciliation quand la source le permet.',
  },
  {
    key: 'csv-import',
    name: 'CSV / Excel Import',
    kind: 'custom',
    connectionModes: ['file_import'],
    defaultCapabilities: ['files.import', 'customers.read', 'orders.read', 'inventory.read'],
    supportedCapabilities: ['files.import', 'customers.read', 'orders.read', 'inventory.read'],
    recommendedFirstSync: ['files.import'],
    notes: 'Important pour PME sans API: mapping sauvegardé + import contrôlé avec evidence.',
  },
];

const CAPABILITY_RISK: Record<IntegrationCapabilityKey, IntegrationCapabilityRisk> = {
  'customers.read': 'read',
  'customers.write': 'controlled_write',
  'orders.read': 'read',
  'orders.write': 'controlled_write',
  'shipments.read': 'read',
  'shipments.write': 'low_write',
  'invoices.read': 'read',
  'invoices.write': 'sensitive_write',
  'payments.read': 'read',
  'payments.write': 'sensitive_write',
  'inventory.read': 'read',
  'inventory.write': 'controlled_write',
  'receiving.read': 'read',
  'receiving.write': 'controlled_write',
  'picking.read': 'read',
  'picking.write': 'controlled_write',
  'webhooks.receive': 'read',
  'files.import': 'read',
};

export function getConnectorProviderBlueprint(key: IntegrationProviderKey): ConnectorProviderBlueprint | undefined {
  return CONNECTOR_PROVIDER_BLUEPRINTS.find((blueprint) => blueprint.key === key);
}

export function capabilityRisk(capability: IntegrationCapabilityKey): IntegrationCapabilityRisk {
  return CAPABILITY_RISK[capability];
}

export function requiresApprovalForCapability(capability: IntegrationCapabilityKey): boolean {
  return CAPABILITY_RISK[capability] === 'controlled_write' || CAPABILITY_RISK[capability] === 'sensitive_write';
}

function policyAllowsDirectUse(
  capability: IntegrationCapabilityKey,
  approvalPolicy: IntegrationAgentApprovalPolicy,
): boolean {
  const risk = capabilityRisk(capability);
  if (risk === 'read') return true;
  if (risk === 'low_write') return approvalPolicy === 'auto_low_risk' || approvalPolicy === 'auto_controlled';
  if (risk === 'controlled_write') return approvalPolicy === 'auto_controlled';
  return false;
}

export function canAgentUseIntegrationCapability(
  context: IntegrationAgentAccessContext,
): IntegrationAgentAccessResult {
  if (context.connectorStatus !== 'ENABLED' || !['live', 'ready'].includes(context.healthState)) {
    return { allowed: false, reason: 'connector_not_live', approvalRequired: false };
  }

  if (!context.connectorCapabilities.includes(context.requestedCapability)) {
    return { allowed: false, reason: 'capability_missing', approvalRequired: false };
  }

  if (!context.agentAllowedCapabilities.includes(context.requestedCapability)) {
    return { allowed: false, reason: 'agent_not_allowed', approvalRequired: false };
  }

  if (!policyAllowsDirectUse(context.requestedCapability, context.approvalPolicy)) {
    return {
      allowed: false,
      reason: 'approval_required',
      approvalRequired: true,
    };
  }

  return { allowed: true, reason: 'allowed', approvalRequired: false };
}

export function summarizeConnectorFoundation(input: ConnectorFoundationInput): ConnectorFoundationSummary {
  const provider = getConnectorProviderBlueprint(input.providerKey);
  const expected = provider?.recommendedFirstSync ?? input.enabledCapabilities;
  const missingMapping = expected.filter((capability) => !input.mappedCapabilities.includes(capability));
  const missingTests = input.enabledCapabilities.filter((capability) => !input.testedCapabilities.includes(capability));

  if (!input.owner) {
    return {
      provider,
      stage: 'owner',
      missingMapping,
      missingTests,
      nextAction: 'Assigner un propriétaire métier avant de connecter le logiciel au tenant.',
    };
  }

  if (input.enabledCapabilities.length === 0) {
    return {
      provider,
      stage: 'capabilities',
      missingMapping,
      missingTests,
      nextAction: 'Choisir les capacités activées pour limiter le scope du connecteur.',
    };
  }

  if (missingMapping.length > 0) {
    return {
      provider,
      stage: 'mapping',
      missingMapping,
      missingTests,
      nextAction: 'Compléter le mapping des champs requis avant le premier test sandbox.',
    };
  }

  if (missingTests.length > 0) {
    return {
      provider,
      stage: 'sandbox',
      missingMapping,
      missingTests,
      nextAction: 'Exécuter un test sandbox et conserver l’evidence avant activation live.',
    };
  }

  return {
    provider,
    stage: 'ready',
    missingMapping,
    missingTests,
    nextAction: 'Activer avec monitoring, taux d’échec 24h et rollback documenté.',
  };
}

export function buildConnectorOnboardingSteps(providerKey: IntegrationProviderKey): ConnectorOnboardingStep[] {
  const provider = getConnectorProviderBlueprint(providerKey);
  const providerName = provider?.name ?? 'le logiciel';

  return [
    {
      key: 'select-provider',
      title: 'Choisir le logiciel',
      description: `Sélectionner ${providerName}, confirmer le propriétaire métier et le tenant cible.`,
      evidenceRequired: false,
    },
    {
      key: 'authenticate',
      title: 'Authentifier sans exposer les secrets',
      description: 'Configurer OAuth, clé API, webhook secret ou import fichier; les secrets devront être chiffrés côté API.',
      evidenceRequired: false,
    },
    {
      key: 'choose-capabilities',
      title: 'Choisir les capacités',
      description: 'Activer seulement les lectures/écritures nécessaires; read-only d’abord pour ERP/comptabilité/WMS.',
      evidenceRequired: false,
    },
    {
      key: 'map-fields',
      title: 'Mapper vers les modèles Pulsar',
      description: 'Relier les champs externes aux modèles canoniques Pulsar et sauvegarder le mapping.',
      evidenceRequired: false,
    },
    {
      key: 'run-sandbox-test',
      title: 'Tester en sandbox avec evidence',
      description: 'Lancer un pull/webhook/import contrôlé, vérifier le résultat et conserver payload résumé + horodatage.',
      evidenceRequired: true,
    },
    {
      key: 'activate-with-monitoring',
      title: 'Activer avec monitoring et gouvernance',
      description: 'Passer live avec health, failure rate, dernier succès, owner et désactivation rapide.',
      evidenceRequired: true,
      agentGate: 'Toute écriture agent passe par ProposedAction tant que la capacité n’est pas explicitement low-risk.',
    },
  ];
}
