export interface ModuleLesson {
  title: string;
  text: string;
  href?: string;
  target?: string;
}
/** Teaching scenarios, not automatic mutations. Each exercise runs in the real module. */
export const MODULE_LESSONS: Record<string, ModuleLesson[]> = {
  services: [
    {
      title: 'Du besoin client aux travaux prouvés',
      text: 'Bienvenue dans Services. Reliez votre accord commercial, les interventions, les heures et pièces utilisées. Les comptes, absences, stocks et factures restent dans leurs modules spécialisés.',
    },
    {
      title: 'Chiffrer puis accepter le devis',
      href: '/services/quotes',
      text: 'Choisissez un client et des prestations Catalogue, saisissez les prix puis enregistrez. Accepter fige cet accord et crée un projet brouillon; activez-le avant de créer des interventions. Aucun message client ne part.',
    },
    {
      title: 'Répartir dans le planning',
      href: '/services/planning',
      text: 'Vérifiez le fuseau entreprise. Ouvrez une intervention ou glissez-la vers un jour et une personne : renseignez la durée, contrôlez les conflits et confirmez. Le glisser seul ne modifie rien; les contraintes inconnues ne signifient pas disponible.',
    },
    {
      title: 'Faire approuver le travail',
      href: '/services/time',
      text: 'L’intervenant déclare puis soumet ses heures. Une autre personne habilitée décide. Les pièces se consomment depuis le stock WMS de l’intervention; les écritures de stock ne viennent jamais de l’AI.',
    },
    {
      title: 'Préparer la facture depuis le projet',
      href: '/services',
      text: 'Dans le projet, sélectionnez les heures approuvées ou pièces consommées et confirmez les tarifs. Le partenaire doit être relié au client Facturation. Une source ne peut être facturée deux fois. Taxes, approbation et envoi restent dans Facturation.',
    },
    {
      title: 'Utiliser un agent avec des sources',
      href: '/services/planning',
      text: 'Le Coordinateur Services et SAV lit les dossiers et prépare des propositions. Les services vérifient encore droits, versions et contraintes à l’exécution. Pas de décision RH, approbation de temps ni envoi client avec ces outils.',
    },
  ],
  hr: [
    {
      title: 'Organiser les personnes, pas les comptes',
      text: 'Bienvenue dans Ressources humaines. Un employé est un dossier professionnel; le compte de connexion et les rôles restent dans Accès. Ce parcours explique les employés, les absences et les habilitations.',
    },
    {
      title: 'Préparer une équipe et un employé',
      href: '/hr/employees',
      text: 'Créez un matricule, choisissez une équipe et associez le compte interne si la personne doit utiliser son espace. Le compte lié est fixe : vérifiez-le avant de valider. Pratiquer ferme ce guide pour vous laisser agir.',
    },
    {
      title: 'Faire décider une absence',
      href: '/hr/leaves',
      text: 'Une demande commence au brouillon. Soumettez des dates inclusives; une autre personne habilitée approuve ou refuse. Le bénéficiaire et le créateur ne peuvent pas approuver eux-mêmes. Une période approuvée ne se corrige pas silencieusement.',
    },
    {
      title: 'Utiliser mon espace personnel',
      href: '/hr/self',
      text: 'Vérifiez le dossier rattaché à votre compte. Préparez puis soumettez votre absence ici. Cet espace ne montre jamais les dossiers des collègues; en cas de mauvais rattachement, contactez votre gestionnaire.',
    },
    {
      title: 'Distinguer compétence et habilitation',
      href: '/hr/skills',
      text: 'Définissez le savoir-faire ou l’autorisation nécessaire. Un intitulé de poste ne prouve pas une habilitation. Le référentiel sert ensuite aux qualifications datées et aux exigences de Fabrication.',
    },
    {
      title: 'Enregistrer une qualification vérifiée',
      href: '/hr/qualifications',
      text: 'Choisissez l’employé et la compétence, les dates de validité et la référence vérifiée. Un gestionnaire habilité atteste cette vérification; pas d’auto-attribution. Un renouvellement crée une nouvelle trace, une révocation garde l’ancienne.',
    },
    {
      title: 'Ce que RH transmet aux opérations',
      text: 'Services lit seulement le signal d’absence avec un droit dédié. Fabrication peut vérifier des exigences sans lire les notes RH. Aucun salaire, diagnostic, paie ou affectation automatique. L’aide « ? » permet de relancer volontairement ce parcours.',
    },
  ],
  quality: [
    {
      title: 'Du contrôle à la correction',
      text: 'Bienvenue dans Qualité. Vous allez suivre un parcours concret : définir ce qui est acceptable, mesurer, traiter un écart et conserver sa preuve. Une clôture Qualité ne libère aucun stock.',
    },
    {
      title: 'Définir les critères avant de contrôler',
      href: '/quality/plans',
      text: 'Créez un plan : par exemple contrôle de réception. Ajoutez un critère conforme/non conforme et une mesure avec unité et bornes. Une inspection copie la version du plan : modifier le plan ne réécrit pas les résultats passés.',
    },
    {
      title: 'Ouvrir le contrôle au bon endroit',
      href: '/quality',
      text: 'Créez une inspection depuis un plan actif. Reliez éventuellement une réception WMS validée, un ordre de fabrication ou un dossier SAV. Ces liens apportent du contexte, ils ne changent ni stock ni statut du dossier source.',
    },
    {
      title: 'Mesurer puis constater le résultat',
      href: '/quality',
      text: 'Démarrez le contrôle et renseignez chaque critère. Vérifiez les unités, puis terminez explicitement. Un échec ouvre une non-conformité dans la même transaction; une mesure manquante ne doit pas être assimilée à une réussite.',
    },
    {
      title: 'Piloter une non-conformité',
      href: '/quality/nonconformities',
      text: 'Affectez un responsable, une échéance et documentez cause/action corrective. Joignez une preuve avant clôture. Les vues Mes dossiers et Échéance dépassée aident à choisir le prochain travail.',
    },
    {
      title: 'Vérifier avant de clore',
      href: '/quality/nonconformities',
      text: 'Déclarez l’action réalisée, vérifiez son résultat puis clôturez avec un motif. L’historique et les preuves restent liés au dossier. Ce parcours ne constitue pas une certification, une signature réglementaire ni une quarantaine automatique.',
    },
  ],
  support: [
    {
      title: 'Prendre en charge un problème client',
      text: 'Bienvenue dans le SAV. La demande suit le problème client; une intervention Services suit le travail à réaliser. Ce ne sont pas deux copies du même dossier.',
    },
    {
      title: 'Qualifier la demande',
      href: '/support',
      text: 'Créez une demande avec le client du Catalogue, le symptôme et la priorité. Décrivez le résultat attendu plutôt qu’une simple tâche. Ne promettez pas un remboursement ou une garantie non vérifiée.',
    },
    {
      title: 'Nommer le responsable et la prochaine échéance',
      href: '/support',
      text: 'Ouvrez la demande et affectez un responsable interne. Fixez la date de suivi, puis utilisez Mes demandes à traiter, Sans responsable ou Échéances dépassées pour organiser la prise en charge. Cette échéance est interne, pas un SLA contractuel.',
    },
    {
      title: 'Relier le travail terrain',
      href: '/support',
      text: 'Si une intervention existe pour le même client, liez-la à la demande. Ouvrez ensuite Services pour planifier le technicien, enregistrer son temps et ses pièces. Le SAV ne consomme pas de stock lui-même.',
    },
    {
      title: 'Résoudre, rouvrir ou clôturer',
      href: '/support',
      text: 'Passez en traitement, consignez la solution puis résolvez. Rouvrez si le problème revient avant clôture; la clôture est définitive. Chaque transition conserve l’auteur et le compte rendu. Les échanges courriel, garanties et retours restent des lots à venir.',
    },
  ],
  purchasing: [
    {
      title: 'Suivre un achat jusqu’à son arrivée',
      text: 'Bienvenue dans Achats fournisseurs. Le module suit une commande, ses lignes, les arrivages partiels et le reste à recevoir. Confirmer une commande ne crée ni stock ni facture.',
    },
    {
      title: 'Préparer fournisseur et articles',
      href: '/purchasing',
      text: 'Le fournisseur et les produits viennent du Catalogue. Pour recevoir du stock, chaque produit doit être relié à un article WMS de même unité. Les prestations ne deviennent pas du stock.',
    },
    {
      title: 'Composer puis figer la commande',
      href: '/purchasing',
      text: 'Au brouillon, renseignez quantités, prix, devise et date attendue. Vérifiez les lignes puis confirmez : elles deviennent non modifiables. Le total hors taxes reste dans la devise de la commande, sans addition entre devises.',
    },
    {
      title: 'Organiser les arrivages',
      href: '/purchasing',
      text: 'Utilisez les files À préparer, Arrivages à suivre et Échéance dépassée. Ouvrez une commande confirmée pour voir les quantités commandées, reçues et restantes par ligne. Un retard ne prouve pas un manque : consultez le reliquat.',
    },
    {
      title: 'Enregistrer une réception partielle',
      href: '/purchasing',
      text: 'Dans Réceptions, choisissez l’entrepôt et les emplacements, saisissez uniquement les quantités arrivées puis confirmez. Le WMS écrit stock et mouvements atomiquement. Après une réponse perdue, reprenez la même opération, jamais une seconde réception.',
    },
    {
      title: 'Traiter le reliquat avant clôture',
      href: '/purchasing',
      text: 'Consultez l’historique et le reste par ligne. Clôturer avec un reliquat exige un motif et ne crée pas de stock manquant. Retour fournisseur, rapprochement facture et envoi automatique ne sont pas encore implémentés.',
    },
  ],
};

/** Distinct business vocabulary for the remaining guides; no generic operations headings. */
export const LESSON_TITLES: Record<string, [string, string, string]> = {
  services: [
    'Préparer un projet client',
    'Planifier les interventions',
    'Prouver le temps et les pièces',
  ],
  transport: [
    'Préparer les données transport',
    'Consolider puis dispatcher',
    'Suivre la livraison et ses preuves',
  ],
  wms: [
    'Organiser entrepôts et emplacements',
    'Recevoir et préparer le stock',
    'Scanner avec confirmation',
  ],
  manufacturing: [
    'Définir postes, gammes et nomenclatures',
    'Planifier et lancer la fabrication',
    'Suivre matières et exécution',
  ],
  yard: [
    'Dessiner les zones et quais',
    'Accueillir puis déplacer une visite',
    'Identifier remorques et dossiers',
  ],
  fleet: [
    'Référencer les actifs',
    'Planifier la maintenance',
    'Vérifier les actifs sur le terrain',
  ],
  billing: [
    'Configurer les références financières',
    'Contrôler les factures',
    'Valider les écritures et paiements',
  ],
  agents: [
    'Choisir un rôle et ses outils',
    'Régler les limites d’autonomie',
    'Contrôler les propositions et exécutions',
  ],
  crm: [
    'Structurer les contacts et le pipeline',
    'Faire avancer une opportunité',
    'Relier les relances au pipeline',
  ],
  catalog: [
    'Unifier les partenaires',
    'Distinguer produit et prestation',
    'Relier les référentiels métier',
  ],
  documentation: [
    'Rechercher une règle métier',
    'Comprendre les connexions',
    'Relancer un parcours guidé',
  ],
  analytics: [
    'Choisir le périmètre d’analyse',
    'Lire les indicateurs',
    'Retrouver le dossier source',
  ],
  sites: ['Préparer une page', 'Composer et prévisualiser', 'Publier le contenu vérifié'],
  procurement: [
    'Définir un appel d’offres',
    'Comparer les offres',
    'Attribuer et conserver la décision',
  ],
  'customer-portal': [
    'Configurer les accès client',
    'Traiter les demandes reçues',
    'Partager uniquement le périmètre autorisé',
  ],
  documents: [
    'Classer un document',
    'Retrouver sa version',
    'Respecter les accès du dossier métier',
  ],
  connect: [
    'Configurer une connexion',
    'Tester le flux de données',
    'Inspecter et reprendre les erreurs',
  ],
  personalize: [
    'Organiser le bureau',
    'Choisir les préférences visuelles',
    'Conserver un espace de travail lisible',
  ],
  emails: [
    'Préparer un gabarit',
    'Configurer le canal d’envoi',
    'Consulter le résultat de l’envoi',
  ],
  settings: [
    'Administrer les comptes',
    'Attribuer les rôles et modules',
    'Contrôler les changements',
  ],
  dashboard: [
    'Retrouver ses applications',
    'Choisir le prochain travail',
    'Ouvrir le dossier concerné',
  ],
};
