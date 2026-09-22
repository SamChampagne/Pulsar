export interface PageGuide {
  purpose: string;
  steps: string[];
  connections: string;
  caution?: string;
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  '/services/planning': {
    purpose:
      'Répartir les interventions par personne, jour et équipe dans le fuseau stable de l’entreprise.',
    steps: [
      'Choisir une période et filtrer la personne; les lignes affichent son équipe RH et les jours d’absence autorisés.',
      'Ouvrir ou glisser une intervention, définir l’intervenant, le début et la durée. Vérifier le créneau puis confirmer; glisser ne persiste rien tout seul.',
      'Ajouter au besoin les exigences de compétences et un poste Fabrication de référence. Les habilitations doivent couvrir toute la période.',
    ],
    connections:
      'RH fournit seulement les dates d’absence et la couverture des qualifications, sans motifs. Mon travail règle le fuseau. Les postes Fabrication fournissent des exigences, pas une réservation machine.',
    caution:
      'Chevauchement connu, absence approuvée et qualification insuffisante sont bloquants. RH absent ou anciennes interventions sans durée restent inconnus. Une modification RH postérieure exige un nouveau contrôle. Pas d’optimisation APS ni de planning multi-intervenants.',
  },
  '/services/quotes': {
    purpose:
      'Préparer un devis en produits/prestations de Catalogue puis figer l’accord commercial vers un projet.',
    steps: [
      'Choisir le client, la devise, une validité facultative et les lignes tarifées; enregistrer le brouillon.',
      'Confirmer l’acceptation du dernier devis enregistré. Elle crée un seul projet brouillon et fige les prix du devis.',
      'Activer le projet, exécuter les interventions, faire approuver les heures et préparer une facture depuis ses travaux.',
    ],
    connections:
      'Catalogue fournit les références. Le projet conserve le devis accepté. Facturation reçoit uniquement les sources de travaux sélectionnées et les tarifs confirmés.',
    caution:
      'Pas de signature électronique, conversion automatique des lignes en interventions, acomptes ou facturation au forfait. Aucun devis ou courriel n’est envoyé. Le chiffrage reste hors taxes; les taxes se traitent sur le brouillon Facturation.',
  },
  '/workbench': {
    purpose: 'Regrouper les suivis actuels des modules et les tâches opérationnelles existantes.',
    steps: [
      'Choisir une source dans À traiter dans mes modules et lire sa raison.',
      'Ouvrir le dossier source, corriger la situation puis actualiser le suivi.',
      'Les administrateurs règlent les sources, le préavis des habilitations et le fuseau; un agent peut analyser les dossiers accessibles.',
    ],
    connections:
      'SAV, Qualité, Services, Achats et RH restent propriétaires des données. Chaque source requiert le module et ses permissions; les détails RH ne sont pas copiés dans les tâches génériques.',
    caution:
      'Ce suivi est calculé à la lecture. Ce ne sont pas des rappels envoyés ni des tâches automatiquement affectées à un worker. Mes responsabilités ne crée pas un propriétaire pour les commandes qui n’en ont pas.',
  },
  '/hr/skills': {
    purpose: 'Définir les compétences et autorisations utiles aux équipes.',
    steps: [
      'Créer un code stable, un nom et une nature.',
      'Attester séparément les qualifications des employés dans Habilitations.',
      'Désactiver une référence obsolète sans effacer les attestations.',
    ],
    connections: 'Fabrication peut réutiliser ces références comme exigences des postes de charge.',
    caution:
      'Une référence inactive ne couvre plus une exigence. Le nom seul ne prouve aucune qualification.',
  },
  '/hr/qualifications': {
    purpose:
      'Conserver les attestations vérifiées et leur validité, avec un historique non réécrit.',
    steps: [
      'Sélectionner l’employé et la compétence actifs.',
      'Vérifier la source et les dates inclusives, puis attester avec hr.qualifications.manage.',
      'Renouveler par une nouvelle attestation; révoquer avec un motif pour retirer la précédente.',
    ],
    connections:
      'Fabrication reçoit seulement la couverture des exigences avec hr.qualifications.read; les références et motifs restent dans RH.',
    caution:
      'Pas d’auto-attestation ni d’auto-révocation. Une révocation est définitive et vaut à la lecture, même pour une date passée. Aucun document réglementaire généré.',
  },
  '/manufacturing/qualifications': {
    purpose: 'Contrôler les savoir-faire exigés par un poste sans consulter les notes RH.',
    steps: [
      'Choisir le poste; avec manufacturing.manage, ajouter ou retirer ses exigences.',
      'Choisir un employé et la date prévue.',
      'Vérifier chaque exigence, puis organiser le travail manuellement.',
    ],
    connections:
      'RH et Fabrication doivent être actifs; manufacturing.read et hr.qualifications.read sont requis. RH demeure propriétaire des attestations.',
    caution:
      'Aucune exigence n’est pas un verdict de qualification. Ce contrôle ne mesure ni disponibilité, ni charge, ni aptitude médicale et ne bloque pas le planning.',
  },
  '/services/interventions': {
    purpose:
      'Planifier les interventions et repérer les absences approuvées des personnes affectées, sans ouvrir leurs dossiers RH.',
    steps: [
      'Ouvrir une intervention sur un projet actif ou en créer une. Choisir une personne et une date/heure prévue.',
      'Lire Absences RH · jour du début. Contrôler le fuseau affiché. Une alerte propose de replanifier manuellement; elle ne bloque pas l’enregistrement.',
      'Comparer le nouvel horaire dans le panneau avant d’enregistrer. Après une approbation ou annulation RH, Actualiser les absences relit les données sans modifier vos champs.',
    ],
    connections:
      'Services + RH activés et services.read + hr.availability.read donnent accès au seul résultat du jour. Les motifs et dossiers restent protégés dans RH. Le résumé de liste couvre la page visible, pas toute l’entreprise.',
    caution:
      'Aucune absence approuvée ne signifie pas disponible. Compte non affectable, dossier RH manquant/inactif, accès absent ou erreur : non vérifié. Pas de contrôle de durée, d’occupation par d’autres interventions ou de capacité Fabrication.',
  },
  '/hr/employees': {
    purpose:
      'Conserver le dossier professionnel de chaque employé, distinct de son compte de connexion.',
    steps: [
      'Préparer les équipes, puis créer un matricule stable avec prénom, nom et poste.',
      'Associer éventuellement un utilisateur interne actif à la création. Cette association est unique et fixe dans ce premier lot.',
      'Corriger le poste ou l’équipe; traiter les absences en cours avant de désactiver le dossier.',
    ],
    connections:
      'Accès conserve le compte et ses rôles. RH conserve le dossier employé et les absences. Une équipe RH ne donne aucun accès.',
    caution:
      'Pas de salaire, données médicales, documents personnels ou paie. Les compétences sont attestées séparément dans Habilitations. Désactiver le dossier ne désactive pas le compte.',
  },
  '/hr/teams': {
    purpose: 'Classer les dossiers employés par équipe professionnelle.',
    steps: [
      'Créer un code et un nom d’équipe.',
      'Affecter les employés depuis leurs fiches.',
      'Réaffecter les employés actifs avant de désactiver une équipe.',
    ],
    connections:
      'Les équipes servent au classement RH; elles ne créent ni rôle de sécurité ni équipe de planning Services.',
    caution: 'Aucune affectation automatique, hiérarchie de gestionnaires ou capacité horaire.',
  },
  '/hr/leaves': {
    purpose: 'Préparer et décider des demandes d’absence de l’entreprise.',
    steps: [
      'Créer un brouillon pour un employé actif avec début et fin inclus.',
      'Soumettre la demande; une autre personne habilitée approuve ou refuse avec un motif.',
      'Consulter l’historique. Une absence approuvée ne peut être annulée que par une autre personne avec hr.approve.',
    ],
    connections:
      'La demande appartient au dossier RH. Elle ne déduit pas un solde légal et ne bloque pas les interventions Services ni les ordres Fabrication.',
    caution:
      'Les dates ne sont modifiables qu’au brouillon. Un chevauchement soumis ou approuvé pour le même employé est refusé, y compris sur la date de frontière.',
  },
  '/hr/self': {
    purpose:
      'Consulter son propre dossier et soumettre ses absences sans accéder aux autres employés.',
    steps: [
      'Vérifier le dossier associé à votre compte. S’il manque, contacter un gestionnaire RH.',
      'Créer une demande avec les dates incluses, enregistrer puis soumettre.',
      'Lire la décision et son motif. Avant décision, retirer vers le brouillon si nécessaire.',
    ],
    connections:
      'L’association compte utilisateur → dossier employé est vérifiée côté serveur à chaque lecture et écriture personnelle.',
    caution:
      'hr.self ne donne aucun droit d’approbation. Une approbation doit être annulée par une autre personne habilitée, jamais silencieusement par son bénéficiaire.',
  },
  '/quality/plans': {
    purpose: 'Définir des contrôles réutilisables, sans réécrire les inspections déjà créées.',
    steps: [
      'Créer un code stable et nommer le plan. Décrire la méthode dans les instructions.',
      'Ajouter de 1 à 30 critères : conforme/non conforme ou mesure numérique avec unité, minimum et maximum inclus.',
      'Enregistrer. Une modification incrémente la version; désactiver empêche uniquement les nouvelles inspections.',
    ],
    connections:
      'Le plan appartient à Qualité. Chaque nouvelle inspection copie sa version, ses consignes et ses critères.',
    caution:
      'Les critères sont figés dès la création du contrôle, pas lors de sa clôture. Les unités sont des libellés : aucune conversion ni tolérance implicite.',
  },
  '/quality/nonconformities': {
    purpose: 'Suivre la correction des écarts détectés dans les contrôles terminés.',
    steps: [
      'Ouvrir la non-conformité créée par le contrôle échoué, affecter un responsable interne actif et fixer une échéance. Filtrer Mes dossiers, Sans responsable ou Échéance dépassée.',
      'Prendre en traitement, enregistrer la cause et l’action corrective, puis déclarer l’action réalisée avec un compte rendu.',
      'Ajouter les preuves PDF, PNG ou JPEG avant la clôture, puis vérifier la correction et clôturer avec un motif. Une action réalisée peut être rouverte avant clôture.',
    ],
    connections:
      'La non-conformité et le contrôle partagent leur journal. La correction ne change pas le résultat historique du contrôle.',
    caution:
      'Clôture définitive. Pas de quarantaine, libération, avoir ou retour fournisseur automatique. Le même gestionnaire peut traiter et vérifier; aucune certification n’est revendiquée.',
  },
  '/services/time': {
    purpose:
      'Soumettre et approuver le temps des interventions. Distinguer heures déclarées, en attente et approuvées, sans créer de paie ni de facture.',
    steps: [
      'Ouvrir une intervention démarrée, puis son onglet Temps de travail pour créer une saisie.',
      'Choisir la date de travail, la durée en minutes, une note et son caractère facturable déclaré.',
      'Soumettre les heures. Une autre personne avec services.time.approve traite la file À approuver : approbation ou demande de correction motivée. Consulter Historique pour retrouver chaque décision.',
    ],
    connections:
      'Utilisateur → intervention → projet → total de temps. Les montants, la paie et la facturation ne sont pas calculés ici.',
    caution:
      'Les heures soumises ou approuvées ne sont pas modifiables directement. Retirer une soumission ou faire rouvrir une approbation avec un motif, puis resoumettre. Les totaux couvrent tous les résultats filtrés, hors annulations. Après une réponse de décision incertaine, vérifier l’état et l’historique avant toute nouvelle action.',
  },
  '/fuel-tables': {
    purpose:
      'Une table de carburant contient les pourcentages de surcharge applicables à partir de dates précises. Elle ne représente pas des achats de carburant.',
    steps: [
      'Créer une table et la nommer selon le contrat ou le transporteur.',
      'Ajouter un pourcentage et sa date d’entrée en vigueur.',
      'Associer cette table à un tarif dans les Tarifs.',
    ],
    connections:
      'Tarif → table de carburant → coût estimé du chargement. Le moteur choisit le palier applicable à la date de référence.',
    caution:
      'Une table seule ne modifie aucun coût. Les coûts des chargements terminés restent figés.',
  },
  '/lanes': {
    purpose:
      'Un corridor (aussi appelé liaison, voie ou lane) décrit une origine et une destination récurrentes. Ce n’est pas la route physique sur la carte.',
    steps: [
      'Cliquer sur Nouveau corridor.',
      'Choisir l’origine et la destination : site, ville, province ou pays.',
      'Ajouter les transporteurs par ordre de préférence, puis associer les tarifs au corridor.',
    ],
    connections:
      'Les tarifs utilisent les corridors pour comparer les prix. L’auto-tender propose le chargement aux transporteurs par ordre de rang.',
    caution:
      'Le corridor le plus spécifique est prioritaire : site, ville, province, puis pays. Les extrémités sont fixes après création.',
  },
  '/loads': {
    purpose:
      'Le chargement regroupe les expéditions qui voyagent ensemble, leurs ressources, leur tournée et leurs preuves de livraison.',
    steps: [
      'Créer un chargement et y affecter les expéditions.',
      'Ouvrir Ressources pour modifier transporteur, véhicule, chauffeur et tarif.',
      'Générer ou modifier la tournée, proposer au transporteur, puis dispatcher.',
    ],
    connections:
      'Commandes → expéditions → chargement → suivi et preuves → facturation. Les dossiers de cour peuvent être reliés sans modifier automatiquement ces statuts.',
    caution:
      'Les ressources et la tournée sont modifiables avant exécution (Ouvert / Planifié). Après dispatch, utilisez les actions de suivi, pas une réécriture de l’historique.',
  },
  '/customers': {
    purpose:
      'Le référentiel clients rassemble les coordonnées commerciales, les lieux et les commandes d’un même client.',
    steps: [
      'Créer une fiche avec un code unique.',
      'Utiliser Modifier pour corriger les coordonnées ou désactiver la fiche.',
      'Ouvrir la fiche pour consulter les commandes et gérer les utilisateurs du portail si vous avez les droits.',
    ],
    connections:
      'Le même client est référencé par les commandes, les factures et son portail. Modifier sa fiche évite de créer des doublons.',
    caution:
      'Désactiver ne supprime ni l’historique ni les opérations en cours. Le code reste fixe.',
  },
  '/carriers': {
    purpose:
      'Le référentiel transporteurs conserve les coordonnées et identifiants des entreprises qui exécutent les transports.',
    steps: [
      'Créer la fiche et renseigner un courriel utilisable pour les propositions.',
      'Modifier les coordonnées, SCAC, MC et DOT depuis Modifier.',
      'Configurer les préférences dans Corridors et affecter les ressources dans les chargements.',
    ],
    connections:
      'Transporteurs → corridors et tarifs → propositions → chargements → factures transporteur.',
    caution: 'Une désactivation ne résilie pas les engagements ni les transports en cours.',
  },
  '/locations': {
    purpose:
      'Les lieux sont partagés entre transport, entrepôt, cour et fabrication. Une même adresse ne doit pas être recréée dans chaque module.',
    steps: [
      'Choisir le pays et le type de lieu.',
      'Renseigner l’adresse, la ville et la province.',
      'Vérifier les coordonnées pour afficher correctement les cartes.',
    ],
    connections:
      'Origines et destinations TMS, entrepôts WMS et sites de cour utilisent ce référentiel.',
    caution:
      'Les suggestions de villes viennent des lieux de votre entreprise. Le géocodage automatique dépend de la configuration du serveur.',
  },
  '/wms/bins': {
    purpose:
      'Un emplacement est une adresse de rangement à l’intérieur d’un entrepôt. La zone regroupe visuellement plusieurs emplacements.',
    steps: [
      'Choisir l’entrepôt.',
      'Créer un emplacement, son type et sa zone.',
      'Consulter les zones depuis le poste Entrepôt et déplacer le stock via un mouvement confirmé.',
    ],
    connections: 'Les réceptions, préparations et mouvements référencent ces emplacements.',
    caution:
      'Renommer une zone ne déplace pas de stock. Une zone vide n’est pas encore un référentiel autonome.',
  },
  '/manufacturing/boms': {
    purpose:
      'Une nomenclature décrit les matières nécessaires pour fabriquer une unité de produit.',
    steps: [
      'Créer le produit et les articles de matière dans le référentiel partagé.',
      'Créer la nomenclature et ses quantités par unité.',
      'Utiliser la nomenclature avec une gamme et un ordre de fabrication.',
    ],
    connections:
      'Articles WMS → nomenclature → ordre de fabrication. La création rapide d’un article utilise le même référentiel, sans copie.',
    caution: 'Créer un article ne crée pas de stock et ne poste aucun mouvement.',
  },
};

export const MODULE_GUIDES: Record<string, PageGuide> = {
  hr: {
    purpose:
      'Organiser les employés, leurs équipes et leurs absences avec des accès dédiés et une décision humaine traçable.',
    steps: [
      'Gestionnaire : préparer les équipes et les dossiers employés. Employé : vérifier dans Mes absences que votre compte est rattaché au bon dossier.',
      'Créer une demande d’absence au brouillon, contrôler les dates incluses puis soumettre. Aucune opération n’est validée par cette visite guidée.',
      'Une autre personne avec hr.read et hr.approve décide et motive. Retrouver le journal, les refus ou annulations; le compte utilisateur et les heures Services restent distincts.',
    ],
    connections:
      'Accès fournit l’identité. Services lit le signal d’absence avec hr.availability.read. Fabrication vérifie les exigences d’un poste avec hr.qualifications.read, sans référence ni motif RH. Aucun planning n’est modifié.',
    caution:
      'Pas de paie, calcul de droits légaux, données médicales, recrutement ou décision AI. Les qualifications sont datées et vérifiées humainement; aucune certification réglementaire n’est délivrée.',
  },
  quality: {
    purpose:
      'Documenter la qualité des produits et opérations, du plan de contrôle à la vérification des corrections.',
    steps: [
      'Préparer un plan actif avec des vérifications conforme/non conforme ou des mesures à bornes incluses. Les consignes et critères sont figés à la création du contrôle.',
      'Créer un contrôle indépendant, ou choisir une réception WMS validée, un ordre de fabrication ou une demande SAV. Démarrer, saisir les résultats et les enregistrer avant de terminer.',
      'Un contrôle terminé avec un échec ouvre une non-conformité. Analyser sa cause, documenter la correction et vérifier son efficacité avant clôture. Le journal conserve chaque décision.',
    ],
    connections:
      'WMS, Fabrication et SAV restent propriétaires des dossiers sources. Les liens se choisissent depuis Qualité et n’exécutent aucune action dans ces modules.',
    caution:
      'Aucun blocage/libération de stock, lot/série, certification, signature ou outil AI Qualité. Une saisie vide ne vaut jamais conforme.',
  },
  support: {
    purpose: 'Recevoir, qualifier et résoudre les demandes de service après-vente des clients.',
    steps: [
      'Choisir un client actif du Catalogue et décrire sa demande, avec une priorité.',
      'Ouvrir la demande, choisir son responsable et son échéance, puis passer En traitement avec un motif. Mes demandes à traiter, Sans responsable et Échéances dépassées organisent le suivi. Si nécessaire, lier une intervention du même client.',
      'Résoudre avec un compte rendu, rouvrir avec un motif si nécessaire, puis clôturer après vérification. Consulter l’historique pour chaque décision.',
    ],
    connections:
      'Catalogue fournit le client. Services conserve l’intervention liée, son temps et ses pièces. La demande SAV reste un dossier distinct, sans effet automatique sur le stock ou la facture.',
    caution:
      'Clôturer est définitif. La priorité ne constitue pas un délai contractuel. Le Coordinateur Services et SAV peut préparer une réponse et proposer un responsable ou une échéance; aucun courriel client ni SLA automatique.',
  },
  documentation: {
    purpose:
      'Comprendre les applications de Pulsar, leurs règles métier et leurs connexions, sans quitter le logiciel.',
    steps: [
      'Rechercher une opération ou choisir une application.',
      'Lire le parcours, les règles et les limites avant de modifier un dossier.',
      'Ouvrir l’application ou relancer sa visite guidée depuis son article.',
    ],
    connections:
      'Les guides suivent les modules et permissions de votre compte. Documentation explique le logiciel; Documents conserve vos fichiers métier.',
  },
  catalog: {
    purpose:
      'Préparer les produits, prestations et partenaires communs aux nouvelles applications Services et Achats fournisseurs.',
    steps: [
      'Créer un partenaire et choisir ses rôles client et fournisseur.',
      'Créer un produit ou une prestation avec son unité.',
      'Sur un produit physique, ouvrir Stock WMS et choisir un article actif de même unité. Modifier ou désactiver une fiche sans supprimer son historique.',
    ],
    connections:
      'Une même fiche peut être sélectionnée dans plusieurs nouvelles applications. Les référentiels historiques CRM, transport et WMS ne sont pas fusionnés automatiquement.',
    caution:
      'Le catalogue ne détient aucun stock. Le type et l’unité d’un article restent fixes après création.',
  },
  purchasing: {
    purpose:
      'Préparer et suivre les engagements d’achat de produits ou prestations auprès de vos fournisseurs.',
    steps: [
      'Préparer un fournisseur et des articles dans Catalogue.',
      'Créer un brouillon avec ses lignes, quantités, prix unitaires et devise.',
      'Confirmer, puis ouvrir Réceptions et reliquats : sélectionner les quantités réellement arrivées et leur emplacement WMS. Répéter pour les livraisons partielles, puis clôturer; un reliquat exige un motif.',
    ],
    connections:
      'Catalogue fournit fournisseurs et produits reliés au WMS. Chaque arrivage confirmé crée une réception WMS validée et actualise le reliquat. Les appels d’offres transport restent distincts.',
    caution:
      'Confirmer ne transmet aucun courriel. Clôturer ne réceptionne pas de stock et ne crée ni facture ni paiement.',
  },
  services: {
    purpose:
      'Organiser le travail client en projets, affecter les interventions et suivre les heures déclarées avec leur compte rendu.',
    steps: [
      'Choisir un client du Catalogue et créer un projet.',
      'Activer le projet, planifier une intervention et choisir son intervenant. Consulter le contrôle RH du jour de début, vérifier le fuseau et adapter manuellement si nécessaire. Le filtre « Mes interventions » retrouve vos affectations.',
      'Démarrer l’intervention. Dans Pièces et stock, confirmer les pièces réellement utilisées si le produit est relié au WMS; un retour intégral conserve les deux mouvements. Déclarer puis soumettre les heures et faire approuver par un autre responsable habilité.',
    ],
    connections:
      'Le Catalogue fournit clients, prestations et produits reliés. WMS tient les quantités des pièces consommées/retournées. Accès fournit les utilisateurs; les heures se consolident par intervention et projet. Une affectation n’accorde aucun droit.',
    caution:
      'La clôture exige des interventions fermées et des temps approuvés ou annulés. Les temps du projet fermé restent en lecture seule. Aucun temps, même approuvé, ne génère de paie, facture ou sortie de pièces.',
  },
  dashboard: {
    purpose:
      'Retrouver les applications et examiner les signaux opérationnels de votre entreprise.',
    steps: [
      'Ouvrir une application depuis le bureau.',
      'Consulter le tableau de bord pour repérer les dossiers à traiter.',
      'Revenir au dossier métier pour effectuer une action.',
    ],
    connections:
      'Le bureau organise les accès; les indicateurs renvoient aux modules activés et aux dossiers que vos permissions permettent de consulter.',
  },
  analytics: {
    purpose: 'Lire les indicateurs et retracer les liens entre événements, tâches et décisions.',
    steps: [
      'Choisir une vue : indicateurs, supervision ou flux.',
      'Examiner la période et le périmètre des résultats.',
      'Ouvrir le dossier source pour comprendre ou corriger la situation.',
    ],
    connections:
      'Les analyses lisent les données des autres modules. Consulter un indicateur ne change pas une opération.',
  },
  sites: {
    purpose: 'Préparer et publier les pages web de votre entreprise.',
    steps: [
      'Créer un brouillon.',
      'Configurer les blocs et vérifier le rendu.',
      'Publier seulement lorsque le contenu est prêt.',
    ],
    connections:
      'La publication rend la page accessible au public; les formulaires peuvent recevoir des soumissions. Un brouillon n’est pas une page publiée.',
  },
  'customer-portal': {
    purpose: 'Gérer les accès clients et leurs demandes de changement.',
    steps: [
      'Ouvrir la fiche du client concerné.',
      'Gérer ses accès au portail avec les permissions appropriées.',
      'Examiner les demandes avant toute décision métier.',
    ],
    connections:
      'Le portail présente les commandes et documents du client. Une demande de changement n’est pas une modification automatique du transport.',
  },
  procurement: {
    purpose: 'Organiser les appels d’offres de transport et les préférences du guide de routage.',
    steps: [
      'Préparer les corridors et les transporteurs.',
      'Créer et suivre un appel d’offres.',
      'Examiner les résultats et le guide de routage.',
    ],
    connections:
      'Les achats utilisent les référentiels transport. Ce module n’est pas un catalogue général de commandes de matières premières.',
  },
  documents: {
    purpose: 'Retrouver les pièces jointes et documents enregistrés dans Pulsar.',
    steps: [
      'Rechercher le document ou son dossier.',
      'Vérifier son contexte avant de le télécharger.',
      'Revenir au module concerné pour poursuivre le traitement.',
    ],
    connections:
      'Les fichiers sont rattachés à des dossiers métier. Ajouter un document ne valide pas automatiquement une livraison, une facture ou un mouvement de stock.',
  },
  emails: {
    purpose: 'Consulter les courriels, préparer les gabarits et configurer leur envoi.',
    steps: [
      'Vérifier la configuration du transport de courriel.',
      'Préparer le gabarit utilisé par le processus.',
      'Contrôler le résultat dans l’historique.',
    ],
    connections:
      'Les invitations, propositions et notifications peuvent produire des courriels. En mode log, ils sont journalisés mais ne sont pas livrés dans une boîte de réception.',
  },
  transport: {
    purpose: 'Organiser les transports de la demande client à la livraison.',
    steps: [
      'Préparer clients, transporteurs et lieux.',
      'Créer puis planifier une commande en expéditions.',
      'Regrouper en chargements, affecter les ressources et suivre l’exécution.',
    ],
    connections:
      'Les lieux sont partagés. Les préparations WMS et dossiers de cour apportent du contexte. La facturation reprend les opérations réalisées.',
  },
  wms: {
    purpose: 'Gérer le stock physique par article et emplacement.',
    steps: [
      'Créer les entrepôts, articles et emplacements.',
      'Réceptionner les entrées et ranger le stock.',
      'Préparer les sorties et consulter le journal des mouvements.',
    ],
    connections:
      'La fabrication référence les articles; le transport peut être lié aux préparations. Seuls les mouvements validés changent le stock.',
  },
  manufacturing: {
    purpose: 'Préparer et suivre la fabrication avec les ressources, nomenclatures et gammes.',
    steps: [
      'Configurer postes et calendriers.',
      'Préparer les nomenclatures et les gammes.',
      'Créer les ordres puis examiner leur planification.',
    ],
    connections:
      'Les articles peuvent être partagés avec l’inventaire. La planification dépend de la disponibilité du moteur APS configuré.',
  },
  yard: {
    purpose: 'Coordonner arrivées, stationnements et rendez-vous aux quais.',
    steps: [
      'Choisir un site et configurer son plan.',
      'Préparer un rendez-vous ou enregistrer une arrivée.',
      'Affecter un emplacement, déplacer puis enregistrer le départ.',
    ],
    connections:
      'Les passages peuvent être reliés aux chargements, réceptions et préparations. Un lien de dossier ne valide pas une opération de stock.',
  },
  fleet: {
    purpose: 'Suivre les véhicules, remorques, échéances et interventions de maintenance.',
    steps: [
      'Examiner le parc et ses alertes.',
      'Créer et démarrer une intervention.',
      'Clôturer l’intervention et vérifier les documents de conformité.',
    ],
    connections:
      'Le parc est partagé avec le transport. La maintenance influence la disponibilité des actifs.',
  },
  billing: {
    purpose: 'Transformer les opérations réalisées en documents financiers contrôlés.',
    steps: [
      'Configurer devises, taxes et paramètres comptables.',
      'Préparer ou rapprocher une facture.',
      'Vérifier puis approuver avant de suivre le paiement.',
    ],
    connections:
      'Les coûts de transport terminés restent figés. Les liens entre factures, paiements et banque assurent la traçabilité.',
  },
  crm: {
    purpose: 'Suivre les contacts, opportunités et prochaines actions commerciales.',
    steps: [
      'Configurer le pipeline.',
      'Créer ou qualifier une opportunité.',
      'Préparer les relances et vérifier les connecteurs avant tout envoi.',
    ],
    connections:
      'Les automatisations s’appuient sur les étapes du pipeline et les connexions configurées.',
  },
  agents: {
    purpose:
      'Configurer et superviser des agents qui utilisent les outils métier avec vos permissions et plafonds.',
    steps: [
      'Configurer le fournisseur du runtime.',
      'Définir le rôle, les outils et limites de l’agent.',
      'Examiner ses activités et approuver ses propositions.',
    ],
    connections:
      'Les agents réutilisent les services métier. Les actions sensibles passent par la gouvernance; l’IA ne remplace pas les règles de stock ou de coût.',
  },
  connect: {
    purpose: 'Centraliser les connexions et échanges avec les systèmes externes.',
    steps: [
      'Choisir le type de connexion.',
      'Configurer la portée et tester.',
      'Vérifier les livraisons ou erreurs avant de rejouer un échange.',
    ],
    connections:
      'Les imports, webhooks, courriels et agents utilisent des accès distincts. Un test peut contacter réellement le service externe.',
  },
  settings: {
    purpose: 'Administrer les accès et les paramètres partagés de votre entreprise.',
    steps: [
      'Définir les rôles.',
      'Inviter les utilisateurs.',
      'Configurer les modules et consulter les audits.',
    ],
    connections:
      'Les permissions déterminent les écrans visibles. L’apparence personnelle se règle uniquement dans Personnalisation.',
  },
  personalize: {
    purpose: 'Adapter votre bureau et votre apparence sans modifier les processus métier.',
    steps: [
      'Choisir le thème et la couleur.',
      'Organiser les applications sur le bureau.',
      'Ajuster le fond et la taille des icônes.',
    ],
    connections:
      'Ces préférences appartiennent à votre utilisateur; elles ne changent pas les permissions ni le branding du portail client.',
  },
};

export function pageGuide(path: string, moduleKey: string): PageGuide | undefined {
  const route = Object.keys(PAGE_GUIDES)
    .sort((a, b) => b.length - a.length)
    .find((key) => path === key || path.startsWith(`${key}/`));
  return route ? PAGE_GUIDES[route] : MODULE_GUIDES[moduleKey];
}
