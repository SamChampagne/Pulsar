import { NotificationLevel } from '../enums/core';

export interface Playbook {
  slaMinutes: number;
  priority: NotificationLevel;
  checklist: string[];
}

export const PLAYBOOKS: Record<string, Playbook> = {
  DELAY: {
    slaMinutes: 120,
    priority: NotificationLevel.CRITICAL,
    checklist: [
      'Contacter le transporteur pour obtenir une ETA mise à jour',
      'Notifier le client de l\'écart de délai',
      'Vérifier les impacts sur les stops suivants',
      'Évaluer si une ressource alternative est nécessaire',
    ],
  },
  TENDER_FAILURE: {
    slaMinutes: 60,
    priority: NotificationLevel.CRITICAL,
    checklist: [
      'Identifier la raison du refus ou de l\'expiration',
      'Lancer une nouvelle soumission vers un transporteur alternatif',
      'Mettre à jour le load avec le nouveau statut',
      'Notifier l\'expéditeur si le délai est impacté',
    ],
  },
  FREIGHT_AUDIT: {
    slaMinutes: 1440,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Comparer chaque ligne de la facture avec le coût figé du load',
      'Identifier et documenter les écarts',
      'Ouvrir un litige pour toute variance hors tolérance',
      'Approuver ou rejeter la facture selon le résultat',
      'Enregistrer le montant récupéré le cas échéant',
    ],
  },
  FLEET_MAINTENANCE: {
    slaMinutes: 480,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Confirmer l\'entrée en atelier de l\'asset',
      'Vérifier la disponibilité d\'un véhicule/remorque de remplacement',
      'Mettre à jour le planning de dispatch en conséquence',
      'Suivre l\'avancement de l\'ordre de travail',
    ],
  },
  FLEET_PM_DUE: {
    slaMinutes: 2880,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Vérifier la date et l\'étendue de l\'entretien préventif',
      'Planifier la mise en atelier avec le gestionnaire de flotte',
      'Confirmer la disponibilité des pièces et du technicien',
      'Mettre à jour le calendrier d\'entretien après complétion',
    ],
  },
  WMS_REPLENISH: {
    slaMinutes: 240,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Valider le stock actuel et le point de commande',
      'Créer ou déclencher une commande de réapprovisionnement',
      'Confirmer la date de livraison prévue',
      'Ajuster la quantité suggérée si nécessaire',
    ],
  },
  WMS_COUNT_VARIANCE: {
    slaMinutes: 480,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Examiner les lignes en écart du comptage cyclique',
      'Effectuer un recomptage pour les articles significatifs',
      'Autoriser les ajustements d\'inventaire après validation',
      'Documenter la cause racine des variances',
    ],
  },
  FULFILLMENT_READY: {
    slaMinutes: 120,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Confirmer que tous les articles du pick order sont préparés',
      'Vérifier le quai d\'expédition assigné',
      'Coordonner le chargement avec le transporteur',
      'Mettre à jour le statut du shipment',
    ],
  },
  YARD_ARRIVAL: {
    slaMinutes: 30,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Confirmer l\'identité du transporteur et de la remorque',
      'Assigner un spot de cour ou un quai disponible',
      'Notifier le responsable de réception ou d\'expédition',
    ],
  },
  YARD_DETENTION: {
    slaMinutes: 120,
    priority: NotificationLevel.CRITICAL,
    checklist: [
      'Identifier la raison du dépassement de la fenêtre libre',
      'Contacter le transporteur pour coordonner le départ',
      'Documenter la durée de détention pour facturation',
      'Mettre à jour la visite avec la résolution',
    ],
  },
  YARD_APPOINTMENT_LATE: {
    slaMinutes: 60,
    priority: NotificationLevel.CRITICAL,
    checklist: [
      'Contacter le transporteur pour obtenir un statut',
      'Évaluer la possibilité de reprogrammer le rendez-vous',
      'Notifier le quai et les équipes impactés',
      'Mettre à jour le rendez-vous si reprogrammé',
    ],
  },
  CRM_STALE_DEAL: {
    slaMinutes: 1440,
    priority: NotificationLevel.WARNING,
    checklist: [
      "Examiner l'historique du deal et de la société",
      'Journaliser une relance (appel/email) appropriée',
      'Faire avancer ou requalifier le deal selon la réponse attendue',
      'Planifier la prochaine étape si nécessaire',
    ],
  },
  CRM_FOLLOWUP_DUE: {
    slaMinutes: 240,
    priority: NotificationLevel.WARNING,
    checklist: [
      'Relire la tâche de relance et son contexte',
      "Exécuter la relance (journaliser l'activité)",
      'Marquer la relance comme effectuée',
      'Créer la prochaine relance si le cycle continue',
    ],
  },
};

export const DEFAULT_PLAYBOOK: Playbook = {
  slaMinutes: 240,
  priority: NotificationLevel.WARNING,
  checklist: [
    'Analyser la situation et identifier la cause racine',
    'Notifier les parties prenantes concernées',
    'Prendre les mesures correctives appropriées',
    'Documenter la résolution et fermer la tâche',
  ],
};

/**
 * Returns the playbook for the given category, or DEFAULT_PLAYBOOK if unknown.
 */
export function getPlaybook(category: string): Playbook {
  return PLAYBOOKS[category] ?? DEFAULT_PLAYBOOK;
}

/**
 * Computes the SLA due date as an ISO string.
 * Pure: never calls Date.now().
 * @param category   Task category
 * @param createdAtMs  Task creation timestamp in milliseconds
 */
export function computeSlaDueAt(category: string, createdAtMs: number): string {
  const { slaMinutes } = getPlaybook(category);
  return new Date(createdAtMs + slaMinutes * 60_000).toISOString();
}

/**
 * Returns true if the SLA deadline has already passed.
 * Returns false if slaDueAt is null or undefined.
 */
export function isSlaBreached(
  slaDueAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (slaDueAt == null) return false;
  return Date.parse(slaDueAt) < nowMs;
}
