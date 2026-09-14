// Pure, browser-safe.
export interface ReactionDescriptor {
  key: string;
  label: string;
  /** Owning module of the operation (display). */
  module: string;
  /** Modules that must be enabled for the tenant or the reaction is a no-op. */
  requiredModules: string[];
  description: string;
  /** Argument keys the handler expects (mapped from the event payload via templates). */
  argKeys: string[];
}

export const REACTION_CATALOG: ReactionDescriptor[] = [
  {
    key: 'create_picks_for_order',
    label: 'Créer les pick orders de la commande',
    module: 'wms',
    requiredModules: ['wms'],
    description:
      'Pour chaque shipment de la commande dont l\'origine est un entrepôt, crée un pick order lié (s\'il n\'en a pas déjà un).',
    argKeys: ['orderId'],
  },
  {
    key: 'draft_customer_invoice',
    label: 'Créer un relevé client brouillon',
    module: 'billing',
    requiredModules: ['billing'],
    description:
      'Crée un relevé client brouillon pour les clients des commandes livrées du load (anti-double-billing).',
    argKeys: ['loadId'],
  },
  {
    key: 'open_maintenance_order',
    label: 'Ouvrir un ordre de maintenance',
    module: 'fleet',
    requiredModules: ['fleet'],
    description:
      'À l\'échéance d\'un entretien préventif, ouvre un ordre de maintenance pour l\'asset dû (s\'il n\'en a pas déjà un d\'ouvert).',
    argKeys: ['assetKind', 'assetId', 'scheduleId', 'name'],
  },
  {
    key: 'assign_dock_appointment',
    label: 'Affecter au quai du rendez-vous',
    module: 'yard',
    requiredModules: ['yard'],
    description:
      'À l\'arrivée d\'une visite liée à un rendez-vous quai, l\'affecte automatiquement au spot du rendez-vous (si libre).',
    argKeys: ['visitId'],
  },
  {
    key: 'close_delivered_transport_order',
    label: 'Fermer les ordres livrés',
    module: 'transportation',
    requiredModules: ['transportation'],
    description:
      'À la complétion d\'un load, ferme les ordres de transport entièrement livrés (COMPLETED → CLOSED).',
    argKeys: ['loadId'],
  },
  {
    key: 'draft_invoice_from_sales_order',
    label: 'Créer un relevé client brouillon depuis la commande',
    module: 'billing',
    requiredModules: ['billing'],
    description:
      "À la facturation d'une commande de vente (sales order INVOICED), crée un relevé client brouillon à partir des lignes de la commande (anti-double-billing).",
    argKeys: ['salesOrderId'],
  },
  {
    key: 'fulfill_sales_order',
    label: 'Marquer la commande comme exécutée (livrée)',
    module: 'crm',
    requiredModules: ['crm'],
    description:
      "À la complétion d'un ordre de transport issu d'une commande de vente, passe la commande CONFIRMED → FULFILLED si tous ses ordres de transport sont terminés (livrés ou annulés) et au moins un livré.",
    argKeys: ['salesOrderId'],
  },
];

const BY_KEY = new Map(REACTION_CATALOG.map((r) => [r.key, r]));
export function reactionByKey(key: string): ReactionDescriptor | undefined {
  return BY_KEY.get(key);
}
