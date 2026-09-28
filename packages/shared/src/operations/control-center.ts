import type { DeploymentObservation } from './pilot-readiness';
/** Read-only operations contracts. Pure data; safe for the browser. */
export type ServiceState =
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'UNVERIFIED';
export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  OPERATIONAL: 'Opérationnel',
  DEGRADED: 'Dégradé',
  UNAVAILABLE: 'Indisponible',
  NOT_CONFIGURED: 'Non configuré',
  UNVERIFIED: 'Non vérifié',
};
export interface ServiceObservation {
  key: string;
  label: string;
  state: ServiceState;
  detail: string;
  nextAction: string;
  checkedAt: string;
  latencyMs?: number;
}
export interface QueueObservation {
  key: string;
  label: string;
  pending: number;
  failed: number;
  oldestPendingAt: string | null;
  lastActivityAt: string | null;
  state: ServiceState;
  detail: string;
}
export interface PlatformOperations {
  deploymentChecks?: DeploymentObservation;
  checkedAt: string;
  environment: { name: string; version: string; uptimeSeconds: number; deployment: string };
  services: ServiceObservation[];
  queues: QueueObservation[];
  queuesAvailable: boolean;
  tenants: {
    total: number;
    active: number;
    suspended: number;
    runtimeConfigured: number;
    agents: number;
  } | null;
  limits: string[];
}
export interface PlatformTenantDiagnostics {
  id: string;
  name: string;
  slug: string;
  status: string;
  modules: string[];
  users: number;
  agents: number;
  integrations: number;
  runtime: { configured: boolean; lastTestAt: string | null; lastTestOk: boolean | null };
  queues: QueueObservation[];
  checkedAt: string;
}
/** No activity is not a successful worker execution. A stale backlog is degraded. */
export function deriveQueueState(
  pending: number,
  failed: number,
  oldest: string | null,
  last: string | null,
  now: number,
): ServiceState {
  if (failed > 0 || (pending > 0 && oldest && now - Date.parse(oldest) > 15 * 60_000))
    return 'DEGRADED';
  return last ? 'OPERATIONAL' : 'UNVERIFIED';
}
export type DossierRootType = 'SALES_ORDER' | 'TRANSPORT_ORDER' | 'SHIPMENT' | 'LOAD';
export interface DossierEntity {
  id: string;
  type: string;
  label: string;
  status: string;
  module: string;
  href: string;
}
export interface DossierActivity {
  id: string;
  kind: 'event' | 'task' | 'action' | 'reaction';
  label: string;
  status: string;
  at: string;
  href?: string;
}
export interface WorkflowDossier {
  root: DossierEntity;
  entities: DossierEntity[];
  links: { from: string; to: string; label: string }[];
  activity: DossierActivity[];
  notices: string[];
  checkedAt: string;
}
