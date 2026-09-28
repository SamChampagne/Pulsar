import type { PlatformOperations } from './control-center';

export interface MigrationObservation {
  state: 'MATCHED' | 'DRIFT' | 'UNVERIFIED';
  expected: number | null;
  applied: number | null;
  pending: number | null;
  failed: number | null;
  changed: number | null;
  unexpected: number | null;
}
export interface DeploymentObservation {
  migrations: MigrationObservation;
  platformMfaEnforced: boolean;
}
export const PILOT_PROFILES = [
  { key: 'SERVICES', label: 'Services et SAV' },
  { key: 'TRANSPORT', label: 'Transport et entrepôt' },
  { key: 'MANUFACTURING', label: 'Fabrication et MRP' },
] as const;
export type PilotProfile = (typeof PILOT_PROFILES)[number]['key'];
export type PilotCheckState = 'OBSERVED' | 'BLOCKED' | 'TO_VERIFY';
export interface PilotCheck {
  key: string;
  label: string;
  state: PilotCheckState;
  detail: string;
  nextAction: string;
  kind: 'TECHNICAL' | 'ACCEPTANCE';
}

/** A technical snapshot never proves customer acceptance. No business effects or saved approvals. */
export function derivePilotReadiness(
  data: PlatformOperations,
  profile: PilotProfile,
  agents = false,
) {
  const checks: PilotCheck[] = [];
  const technical = (
    key: string,
    label: string,
    state: PilotCheckState,
    detail: string,
    nextAction: string,
  ) => checks.push({ key, label, state, detail, nextAction, kind: 'TECHNICAL' });
  const acceptance = (key: string, label: string, detail: string, nextAction: string) =>
    checks.push({ key, label, detail, nextAction, state: 'TO_VERIFY', kind: 'ACCEPTANCE' });
  const service = (key: string, label: string) => {
    const s = data.services.find((s) => s.key === key);
    technical(
      key,
      label,
      !s || s.state === 'UNVERIFIED'
        ? 'TO_VERIFY'
        : s.state === 'OPERATIONAL'
          ? 'OBSERVED'
          : 'BLOCKED',
      s?.detail ?? 'Aucune observation disponible.',
      s?.nextAction ?? 'Actualiser le diagnostic.',
    );
  };
  service('api', 'Réponse API');
  service('postgres', 'Connexion à la base');
  const migrations = data.deploymentChecks?.migrations;
  technical(
    'migrations',
    'Migrations de cette version',
    !migrations || migrations.state === 'UNVERIFIED'
      ? 'TO_VERIFY'
      : migrations.state === 'MATCHED'
        ? 'OBSERVED'
        : 'BLOCKED',
    migrations?.state === 'MATCHED'
      ? `${migrations.expected} scripts correspondent à l’historique appliqué.`
      : migrations?.state === 'DRIFT'
        ? `En attente : ${migrations.pending}; en échec : ${migrations.failed}; modifiés : ${migrations.changed}; hors version : ${migrations.unexpected}.`
        : 'Comparaison indisponible. Aucun nombre supposé.',
    'Comparer les scripts livrés à la base cible. Appliquer les migrations par le runbook, jamais depuis ce diagnostic.',
  );
  const identified = /^[a-f0-9]{40}$/i.test(data.environment.version);
  technical(
    'version',
    'Révision livrée identifiable',
    identified ? 'OBSERVED' : 'TO_VERIFY',
    identified
      ? 'Un SHA Git complet est déclaré par le déploiement; le contenu de l’image reste à vérifier.'
      : 'La version déclarée n’est pas un SHA Git complet. Les essais doivent être rattachés à une révision.',
    'Livrer une image issue du commit validé et renseigner PULSAR_BUILD_VERSION. Ce libellé ne prouve pas la CI.',
  );
  technical(
    'mfa',
    'Politique MFA plateforme',
    !data.deploymentChecks
      ? 'TO_VERIFY'
      : data.deploymentChecks.platformMfaEnforced
        ? 'OBSERVED'
        : 'BLOCKED',
    data.deploymentChecks?.platformMfaEnforced
      ? 'L’enrôlement MFA est imposé aux prochaines connexions plateforme.'
      : 'Le MFA obligatoire n’est pas observé. Ce contrôle ne concerne pas le MFA des utilisateurs entreprise.',
    'Imposer PLATFORM_MFA_ENFORCED sur le serveur puis tester enrôlement, connexion et récupération; vérifier les sessions déjà ouvertes.',
  );
  service('email', 'Transport courriel global');
  acceptance(
    'identity',
    'Entreprise pilote et droits limités',
    'Le diagnostic global ne valide ni les rôles ni les connexions propres à une entreprise.',
    'Tester deux entreprises distinctes, gestionnaire/intervenant/lecteur, modules seuls et combinés; vérifier refus API et portail.',
  );
  acceptance(
    'https',
    'Accès HTTPS et réseau du VPS',
    'Non testé depuis ce diagnostic.',
    'Vérifier DNS, certificat et renouvellement, proxy, absence d’exposition publique de PostgreSQL/API et accès opérateur.',
  );
  acceptance(
    'restore',
    'Restauration base, documents et clés',
    'Une base accessible n’est pas une preuve de restauration.',
    'Restaurer une sauvegarde et un document dans un environnement séparé; comparer les contenus et conserver une preuve datée, sans secrets.',
  );
  acceptance(
    'email-delivery',
    'Invitation et remise réelle',
    'Un transport configuré ne prouve pas la réception.',
    'Envoyer explicitement vers une boîte de recette autorisée, ouvrir l’invitation et tester expiration, droits et remise des documents.',
  );
  acceptance(
    'workflow',
    'Parcours métier complet',
    profile === 'SERVICES'
      ? 'Devis → projet → intervention → temps/pièces → facture → SAV et correction.'
      : profile === 'TRANSPORT'
        ? 'Ordre → expédition → chargement → livraison/POD → facture, avec réserves et livraison partielle.'
        : 'Demande → MRP → achat/réception → OF → déclaration → stock/Qualité, avec manquants et corrections.',
    'Rejouer le parcours avec un opérateur; vérifier origine, état, blocage, prochaine action, reprise réseau et absence de double effet. Noter les limites.',
  );
  acceptance(
    'finance',
    'Rôle comptable de l’entreprise',
    'Le profil natif/externe n’active ni comptabilité officielle ni connecteur.',
    'Choisir le système de référence et vérifier factures/avoirs/paiements et rapports dans chaque devise. Ne pas assimiler le registre fournisseur à une dette comptabilisée.',
  );
  acceptance(
    'load',
    'Charge et reprise après interruption',
    'La santé actuelle ne mesure pas les performances ni la récupération des files.',
    'Mesurer les parcours représentatifs, arrêter/reprendre les workers en recette et vérifier les actions au résultat incertain avant toute relance.',
  );
  if (profile !== 'SERVICES')
    acceptance(
      'scanners',
      'Lecteurs de codes-barres réels',
      'Le scan simulé ne qualifie pas les lecteurs USB/Bluetooth ou Zebra Android.',
      'Tester les lecteurs utilisés : suffixe Entrée, doublon, article inconnu, unité/colis, permissions et reprise réseau.',
    );
  if (profile === 'MANUFACTURING') {
    service('aps', 'Moteur APS / MRP');
    acceptance(
      'aps-run',
      'Calcul et publication Fabrication',
      'Une sonde APS verte ne prouve pas un calcul métier.',
      'Tester un calcul sur données de recette et sa revue/publication; vérifier matières, sites, calendriers et refus des entrées périmées.',
    );
  }
  if (agents) {
    service('agents', 'Runtime des agents');
    acceptance(
      'agent-mission',
      'Mission IA gouvernée',
      'Installation et configuration ne prouvent pas la qualité d’une mission.',
      'Avec fournisseur et budget autorisés : tester une mission en PROPOSE, droits minimaux, plafonds, refus périmé, prompt malveillant, interruption et coût/latence.',
    );
  }
  const blocked = checks.filter((c) => c.state === 'BLOCKED').length;
  return {
    schemaVersion: 1 as const,
    checkedAt: data.checkedAt,
    environment: { name: data.environment.name, version: data.environment.version },
    profile,
    agents,
    status: blocked ? ('BLOCKED' as const) : ('ACCEPTANCE_REQUIRED' as const),
    counts: {
      blocked,
      observed: checks.filter((c) => c.state === 'OBSERVED').length,
      toVerify: checks.filter((c) => c.state === 'TO_VERIFY').length,
    },
    checks,
    notice:
      'Précontrôle en lecture seule, pas une autorisation de production. Aucun test terrain ni action métier déclenché; aucune preuve externe conservée ici.',
  };
}
