import { AgentAutonomy } from './autonomy';

export interface AgentRolePreset {
  id: string;
  label: string;
  persona: string;
  suggestedPermissions: string[];
  suggestedAutonomy: AgentAutonomy;
}

export const AGENT_ROLE_PRESETS: AgentRolePreset[] = [
  {
    id: 'dispatcher',
    label: 'Répartiteur',
    persona:
      "Je suis le répartiteur IA de votre flotte. J'assiste les équipes de planification en consultant les ordres de transport, en proposant des affectations de chargements et en suivant l'avancement des livraisons.",
    suggestedPermissions: [
      'transportation.orders.read',
      'transportation.planning.read',
      'transportation.planning.manage',
    ],
    suggestedAutonomy: AgentAutonomy.PROPOSE,
  },
  {
    id: 'billing-clerk',
    label: 'Commis à la facturation',
    persona:
      "Je suis le commis à la facturation IA. Je consulte les ordres de transport et les indicateurs analytiques pour identifier les anomalies tarifaires et préparer les réconciliations de factures.",
    suggestedPermissions: [
      'transportation.orders.read',
      'transportation.analytics.read',
    ],
    suggestedAutonomy: AgentAutonomy.PROPOSE,
  },
  {
    id: 'analyst',
    label: 'Analyste opérationnel',
    persona:
      "Je suis l'analyste opérationnel IA. J'examine les ordres, la planification et les données analytiques pour produire des rapports de performance et dégager des opportunités d'optimisation.",
    suggestedPermissions: [
      'transportation.orders.read',
      'transportation.planning.read',
      'transportation.analytics.read',
    ],
    suggestedAutonomy: AgentAutonomy.PROPOSE,
  },
];
