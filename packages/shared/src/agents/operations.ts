export type AgentOperationSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface AgentOperationKpis {
  actions: {
    total: number;
    pending: number;
  };
  errorRate: number;
  breakerTrips: number;
}

export interface AgentOperationCaps {
  maxAmountPerAction?: number;
  maxActionsPerMinute?: number;
}

export interface AgentOperationInput {
  status: string;
  autonomyLevel?: string | null;
  breakerTrippedAt?: string | null;
  kpis: AgentOperationKpis;
  caps?: AgentOperationCaps;
}

export interface AgentOperationAttention {
  severity: AgentOperationSeverity;
  reason: string;
  nextStep: string;
}

export function computeAgentAttention(agent: AgentOperationInput): AgentOperationAttention {
  if (agent.breakerTrippedAt) {
    return {
      severity: 'critical',
      reason: 'Circuit breaker actif',
      nextStep: 'Réarmer seulement après revue des dernières actions et erreurs.',
    };
  }

  if (agent.status === 'REVOKED') {
    return {
      severity: 'info',
      reason: 'Agent révoqué',
      nextStep: 'Archiver ou recréer un nouvel employé IA si le rôle existe encore.',
    };
  }

  if (agent.status === 'PAUSED') {
    return {
      severity: 'warning',
      reason: 'Agent en pause',
      nextStep: 'Reprendre après validation de la configuration et des caps.',
    };
  }

  if (agent.kpis.actions.pending > 0) {
    return {
      severity: 'warning',
      reason: `${agent.kpis.actions.pending} approbations en attente`,
      nextStep: 'Traiter la file de gouvernance avant de lui confier plus de travail.',
    };
  }

  if (agent.kpis.errorRate >= 0.15) {
    return {
      severity: 'warning',
      reason: `Taux d'erreur ${Math.round(agent.kpis.errorRate * 100)}%`,
      nextStep: 'Lire la timeline et corriger le prompt, les permissions ou le runtime.',
    };
  }

  if (agent.kpis.actions.total === 0) {
    return {
      severity: 'info',
      reason: 'Aucune action récente',
      nextStep: 'Lancer une tâche contrôlée pour valider sa boucle opérationnelle.',
    };
  }

  return {
    severity: 'ok',
    reason: 'Boucle opérationnelle saine',
    nextStep: 'Surveiller les KPI et augmenter l’autonomie seulement avec confirmation humaine.',
  };
}

export function rankAgentForOperations(attention: AgentOperationAttention): number {
  const base: Record<AgentOperationSeverity, number> = {
    critical: 1000,
    warning: 700,
    info: 300,
    ok: 0,
  };
  return base[attention.severity];
}

export function summarizeAgentOperationMode(agent: Pick<AgentOperationInput, 'status' | 'autonomyLevel' | 'caps'>): string {
  const chunks: string[] = [];
  if (agent.status !== 'ACTIVE') chunks.push(agent.status);
  chunks.push(agent.autonomyLevel ?? 'PROPOSE');
  if (agent.caps?.maxAmountPerAction != null) chunks.push(`cap ${agent.caps.maxAmountPerAction}$/action`);
  if (agent.caps?.maxActionsPerMinute != null) chunks.push(`${agent.caps.maxActionsPerMinute}/min`);
  return chunks.join(' · ');
}
