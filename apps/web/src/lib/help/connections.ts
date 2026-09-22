/** Versioned, editorial contracts: not a live integration monitor or a promise of automation. */
export const CONNECTION_KINDS = {
  reference: 'Référence partagée',
  operation: 'Action métier disponible',
  context: 'Lien de contexte',
  configured: 'Automatisation à configurer',
  planned: 'Non connecté actuellement',
} as const;
export interface ModuleConnection {
  id: string;
  from: string;
  to: string;
  title: string;
  kind: keyof typeof CONNECTION_KINDS;
  owner: string;
  requires: string;
  trigger: string;
  data: string;
  effect: string;
  noEffect: string;
  recovery: string;
}
export const MODULE_CONNECTIONS: ModuleConnection[] = [
  {
    id: 'hr-settings',
    from: 'hr',
    to: 'settings',
    title: 'Dossier employé et compte de connexion',
    kind: 'reference',
    owner:
      'Accès conserve le compte, le statut et les rôles; RH conserve le dossier professionnel et les absences.',
    requires:
      'RH activé, hr.read + hr.manage pour créer le lien; hr.self pour consulter ensuite son propre dossier.',
    trigger: 'Sélectionner un utilisateur interne actif lors de la création du dossier employé.',
    data: 'Un lien facultatif, unique dans l’entreprise, vers le compte utilisateur. Aucun mot de passe ni jeton copié.',
    effect:
      'Les endpoints personnels vérifient ce lien pour limiter le profil, les demandes et le journal au seul bénéficiaire.',
    noEffect:
      'Aucune création de compte, attribution de rôle, désactivation de login ou réaffectation automatique du lien.',
    recovery:
      'Après une erreur, vérifier la fiche et le matricule. Le compte associé reste fixe dans ce lot; ne pas créer un doublon pour contourner le contrôle.',
  },
  {
    id: 'hr-services',
    from: 'hr',
    to: 'services',
    title: 'Absences approuvées et affectation Services',
    kind: 'context',
    owner:
      'RH garde les demandes et décisions. Services garde les affectations et les heures réellement déclarées.',
    requires:
      'Services et RH activés, services.read + hr.availability.read. Ce droit minimal ne donne pas accès aux dossiers, notes ou décisions RH; hr.read ne le remplace pas.',
    trigger:
      'Ouvrir les interventions ou le panneau de planification, choisir une personne et une date/heure. Actualiser après une décision RH; le retour au navigateur relance aussi la lecture.',
    data: 'Liste historique : résultat pour le jour du début dans le fuseau du navigateur. Planning : jours d’absence visibles de la période dans le fuseau entreprise, équipe et couverture des exigences. Jamais les motifs, types, numéros ou références d’attestation.',
    effect:
      'La liste garde son alerte minimale. Pour une intervention avec durée, le planning refuse les chevauchements connus, absences approuvées et compétences insuffisantes sur toute la période; le glisser prépare une confirmation.',
    noEffect:
      'Pas de réservation machine, paie ou recalcul Fabrication. Aucune absence approuvée ne garantit une capacité libre. Les agents autorisés peuvent vérifier les créneaux, sans accéder aux raisons RH ni décider des habilitations.',
    recovery:
      'Dossier employé manquant/inactif, module/droit absent ou erreur réseau = non vérifié, jamais disponible. Vérifier le fuseau, les accès et le lien fixe compte/employé; actualiser sans changer la demande RH.',
  },
  {
    id: 'hr-manufacturing',
    from: 'hr',
    to: 'manufacturing',
    title: 'Habilitations et exigences des postes',
    kind: 'context',
    owner:
      'RH possède les attestations, dates et révocations. Fabrication définit les compétences requises par poste de charge.',
    requires:
      'RH et Fabrication activés; manufacturing.read + hr.qualifications.read. Modifier les exigences demande aussi manufacturing.manage.',
    trigger:
      'Dans Qualifications des opérateurs, choisir le poste, l’employé et la date prévue, puis lancer Vérifier les qualifications.',
    data: 'Identité minimale de l’employé et couverture par exigence. Aucun certificat, référence, motif de révocation ou dossier RH transmis.',
    effect:
      'Toutes les exigences doivent être couvertes par une attestation active aux dates inclusives. Une référence ou un employé inactifs ne couvrent rien; aucune exigence reste un résultat distinct.',
    noEffect:
      'Pas de contrôle des absences, blocage d’affectation, disponibilité, calcul de capacité, remplacement, export paie ou optimisation automatique.',
    recovery:
      'Relancer le contrôle après tout changement. Une révocation actuelle invalide aussi une date passée : le résultat n’est pas une preuve historique d’autorisation.',
  },
  ...(
    [
      [
        'wms',
        'réception WMS validée',
        'Entrepôt conserve la réception, ses lignes et les mouvements de stock.',
      ],
      [
        'manufacturing',
        'ordre de fabrication',
        'Fabrication conserve la nomenclature, les opérations et le cycle de production.',
      ],
      [
        'support',
        'demande SAV',
        'SAV conserve le signal client, sa priorité, son intervention et sa résolution.',
      ],
    ] as const
  ).map(
    ([target, label, owner]): ModuleConnection => ({
      id: `quality-${target}`,
      from: 'quality',
      to: target,
      title: `Contrôle lié à une ${label}`.replace('une ordre', 'un ordre'),
      kind: 'context',
      owner: `Qualité conserve les critères figés, résultats et non-conformités. ${owner}`,
      requires: `Qualité activé avec quality.read/manage; ${target} activé et ${target}.read pour choisir ou consulter la source. Même entreprise obligatoire.`,
      trigger: `Créer un contrôle dans Qualité et choisir une ${label}. Le lien reste fixe; aucune création automatique depuis le dossier source.`,
      data: 'Identifiant du dossier source, libellé et lien de navigation autorisés. Aucun stock, résultat de production ou historique SAV copié dans les résultats.',
      effect:
        'L’opérateur retrouve le contexte. Un contrôle échoué ouvre une non-conformité uniquement dans Qualité, dans la transaction de terminaison.',
      noEffect:
        'Aucune quarantaine, libération de stock ou transition dans le dossier source. Clôturer la correction ne rend pas le contrôle initial conforme.',
      recovery:
        'Après une création incertaine, reprendre la même clé conservée. Après une décision incertaine, recharger le contrôle et lire son journal. Une correction finale exige un nouveau contrôle.',
    }),
  ),
  {
    id: 'support-services',
    from: 'support',
    to: 'services',
    title: 'Demande SAV et intervention du client',
    kind: 'context',
    owner:
      'SAV garde le problème, la priorité et la résolution; Services conserve le travail, ses heures et ses pièces.',
    requires:
      'SAV activé et support.manage; pour lier, Services activé et services.read. Les deux dossiers doivent concerner le même client Catalogue.',
    trigger:
      'Dans la qualification de la demande, sélectionner une intervention existante du même client.',
    data: 'Identifiant d’intervention et lien de navigation, sans copie des temps ni des quantités de pièces.',
    effect:
      'Le gestionnaire retrouve le travail associé à la demande et conserve sa décision de résolution dans l’historique SAV.',
    noEffect:
      'Résoudre le ticket ne termine pas l’intervention. Terminer une intervention ne résout pas le ticket. Aucun stock, avoir, facture ou message client automatique.',
    recovery:
      'Corriger le lien tant que la demande est ouverte/en traitement. Rouvrir une demande résolue avec motif; une clôture définitive ne se réécrit pas.',
  },
  {
    id: 'settings-services',
    from: 'settings',
    to: 'services',
    title: 'Accès, personnes et séparation des responsabilités',
    kind: 'reference',
    owner: 'Accès gère les comptes et rôles; Services conserve les affectations et décisions.',
    requires:
      'Utilisateur interne actif de la même entreprise. Permissions et activation de module sont deux conditions distinctes.',
    trigger:
      'Un administrateur attribue les rôles; un gestionnaire choisit ensuite un intervenant dans Services.',
    data: 'Identifiant utilisateur, nom et état actif; aucun mot de passe dans la fiche d’intervention.',
    effect:
      'L’utilisateur peut retrouver ses affectations selon ses permissions. L’approbation du temps exige services.time.approve et un acteur indépendant.',
    noEffect:
      'Être affecté à une intervention ne donne aucun droit supplémentaire et ne réserve pas la disponibilité. services.manage ne donne pas implicitement le droit d’approbation.',
    recovery:
      'Après changement de rôle, rafraîchir la session. Réaffecter le travail d’une personne désactivée; conserver son identité sur les traces passées.',
  },
  {
    id: 'personalize-dashboard',
    from: 'personalize',
    to: 'dashboard',
    title: 'Bureau personnel et applications autorisées',
    kind: 'configured',
    owner:
      'Personnalisation conserve les préférences de l’utilisateur; le bureau applique toujours les règles d’accès.',
    requires: 'Un compte interne et les accès aux applications que l’on souhaite voir.',
    trigger: 'Changer le thème, le fond ou la disposition du bureau.',
    data: 'Préférences personnelles d’affichage, pas les données métier des applications.',
    effect: 'Le bureau et l’apparence s’adaptent à cet utilisateur.',
    noEffect:
      'Déplacer une icône ne crée ni ne désactive un module. Le branding du portail client reste un autre réglage.',
    recovery:
      'Revenir dans Personnalisation pour corriger la disposition. Si une application manque, vérifier activation et rôle dans Accès, pas le thème.',
  },
  {
    id: 'documentation-documents',
    from: 'documentation',
    to: 'documents',
    title: 'Manuel du logiciel ou pièces de l’entreprise ?',
    kind: 'context',
    owner: 'Documentation explique le logiciel; Documents conserve les fichiers métier.',
    requires:
      'Compte interne pour le manuel; permissions du dossier et des fichiers pour les pièces jointes.',
    trigger:
      'Lire un guide pour comprendre le processus, puis ouvrir Documents ou le dossier métier pour consulter ses justificatifs.',
    data: 'Les guides sont du contenu officiel versionné avec le logiciel. Ils ne lisent pas les pièces privées de l’entreprise.',
    effect:
      'Le manuel permet de comprendre quand créer/consulter une pièce et quelle action métier effectuer ensuite.',
    noEffect:
      'Lire une règle ne valide aucun dossier. Téléverser une pièce ne modifie pas automatiquement le manuel, une livraison ou une facture.',
    recovery:
      'Utiliser l’aide de la page et le tutoriel pour se repérer. Les procédures privées rédigées par entreprise et leur validation éditoriale restent à développer.',
  },
  {
    id: 'analytics-transport',
    from: 'analytics',
    to: 'transport',
    title: 'Indicateurs et traces des flux',
    kind: 'context',
    owner:
      'Transport conserve les dossiers; Analytics calcule les vues depuis les événements et traces disponibles.',
    requires:
      'Module Analytics et ses droits, événements existants et accès au dossier source pour approfondir.',
    trigger: 'Ouvrir les indicateurs, la timeline ou la trace d’une entité.',
    data: 'Événements, tâches et propositions disponibles dans le tenant; liens et ratios calculés à la lecture.',
    effect:
      'La supervision aide à comprendre l’enchaînement des dossiers et à repérer un traitement à vérifier.',
    noEffect:
      'Un indicateur ne modifie pas une livraison, ne corrige pas le stock et ne remplace pas le dossier source. Une absence d’événement ne prouve pas l’absence d’une opération.',
    recovery:
      'Revenir au dossier et au journal métier pour confirmer le résultat. Les connexions documentées sont un manuel, pas un écran de santé en temps réel.',
  },
  {
    id: 'catalog-services',
    from: 'catalog',
    to: 'services',
    title: 'Client et prestation d’une intervention',
    kind: 'reference',
    owner: 'Catalogue garde les fiches; Services garde le projet et l’intervention.',
    requires:
      'Un client actif. La prestation est facultative et doit être de type SERVICE. Droits de gestion Services pour créer le dossier.',
    trigger:
      'Sélectionner le client du projet, puis éventuellement une prestation dans l’intervention.',
    data: 'Identifiants des fiches, noms, codes et unités. Les sélecteurs Services ne donnent pas accès aux coordonnées complètes du partenaire.',
    effect:
      'Le projet reste lié à son client, et le travail à la prestation choisie. Les références existantes sont consultables via Services même sans accès à l’éditeur Catalogue.',
    noEffect:
      'Aucune consommation de pièce, conversion CRM, facture ou affectation automatique de technicien.',
    recovery:
      'Corriger le dossier tant qu’il est ouvert. Une fiche désactivée reste dans les dossiers historiques, mais ne se choisit plus dans un nouveau dossier.',
  },
  {
    id: 'catalog-purchasing',
    from: 'catalog',
    to: 'purchasing',
    title: 'Fournisseurs et lignes d’achat',
    kind: 'reference',
    owner: 'Catalogue décrit le fournisseur et l’article; Achats garde l’engagement et ses prix.',
    requires:
      'Fournisseur actif, articles actifs, purchasing.manage. Le partenaire peut être à la fois client et fournisseur.',
    trigger: 'Créer un brouillon fournisseur et sélectionner ses lignes.',
    data: 'Références des articles et du fournisseur; copie du libellé et de l’unité sur chaque ligne.',
    effect:
      'Les quantités et prix produisent un total hors taxes dans une seule devise. La confirmation fige les lignes.',
    noEffect:
      'Une modification ultérieure du Catalogue ne réécrit pas les libellés déjà capturés. Confirmer n’envoie pas le bon au fournisseur.',
    recovery:
      'Corriger le brouillon avant confirmation. Après confirmation, suivre les actions de clôture/annulation; aucun effacement de l’historique.',
  },
  {
    id: 'catalog-wms',
    from: 'catalog',
    to: 'wms',
    title: 'Correspondance produit ↔ article physique',
    kind: 'operation',
    owner:
      'Catalogue décrit le produit commercial. WMS conserve son article physique et le stock par emplacement.',
    requires:
      'Catalogue et Entrepôt activés; catalog.manage et wms.read. Produit GOODS et article WMS actifs avec exactement la même unité.',
    trigger:
      'Dans Catalogue, ouvrir Stock WMS sur un produit, choisir l’article puis enregistrer la correspondance.',
    data: 'Un lien explicite un-à-un entre les deux identifiants. Le nom, le code et le stock ne sont pas copiés.',
    effect:
      'Le produit peut être proposé pour les consommations Services. L’unité WMS ne peut plus changer tant qu’il est lié, ni après une consommation historique.',
    noEffect:
      'Aucun stock créé, aucun mouvement, aucune fusion automatique par code. Deux codes identiques ne suffisent pas à établir le lien.',
    recovery:
      'Retirer ou remplacer la correspondance avec sa version actuelle. Les consommations passées conservent leur article WMS original et leurs unités, même après remplacement.',
  },
  {
    id: 'services-wms',
    from: 'services',
    to: 'wms',
    title: 'Pièces utilisées et retour physique',
    kind: 'operation',
    owner: 'Services conserve la consommation; WMS est la seule autorité du stock.',
    requires:
      'Intervention en cours dans un projet actif, produit relié et emplacement actif. Services et WMS activés; services.read/manage et wms.read/manage.',
    trigger:
      'Ouvrir Pièces et stock, choisir le produit, l’emplacement, la quantité et l’utilisation; confirmer le mouvement physique.',
    data: 'Article WMS, emplacement, quantité à trois décimales maximum, auteur, motif, numéro d’intervention. Libellé, code, unité et emplacement sont capturés pour l’historique.',
    effect:
      'La sortie et la consommation sont enregistrées ensemble. Le disponible est revérifié sous verrou; aucun stock négatif. Le retour intégral crée un second mouvement vers l’emplacement d’origine.',
    noEffect:
      'Le disponible affiché n’est pas réservé. Ni la sélection de prestation, ni les heures, ni la clôture ne consomment du stock. Aucun prix ni montant facturé n’est calculé.',
    recovery:
      'Après coupure, reprendre la demande conservée avec sa même clé. Pour une erreur physique, retourner toutes les pièces de la ligne avec motif, puis saisir la bonne consommation si l’intervention est encore en cours. Retour partiel non disponible. Projet fermé : aucune correction silencieuse.',
  },
  {
    id: 'services-billing',
    from: 'services',
    to: 'billing',
    title: 'Heures et pièces vers la facturation',
    kind: 'operation',
    owner:
      'Services détient heures et pièces; Facturation conserve le brouillon, les prix figés, taxes, approbation et paiement.',
    requires:
      'Services et Billing activés, lecture des deux modules et gestion Services/factures client. Partenaire actif relié explicitement à un client Facturation actif.',
    trigger:
      'Depuis un projet, choisir les sources dans Travaux à facturer, confirmer les tarifs et créer le brouillon.',
    data: 'Quantité et version de chaque heure approuvée ou pièce consommée; devise, prix figé, lien unique à la source et clé de reprise.',
    effect:
      'Création atomique d’un brouillon existant de Facturation. Les contraintes empêchent une source de figurer sur deux factures. Les taxes sont appliquées ensuite dans Facturation.',
    noEffect:
      'Ni approuver le temps, ni terminer une intervention ou un projet ne crée une facture, une paie ou une écriture comptable.',
    recovery:
      'Après coupure, reprendre la même demande conservée. Supprimer un brouillon libère les sources; sa clé ne peut pas recréer la facture supprimée. Une facture approuvée bloque les corrections silencieuses; les avoirs intégrés restent un prochain lot.',
  },
  {
    id: 'purchasing-wms',
    from: 'purchasing',
    to: 'wms',
    title: 'Commande fournisseur et réception',
    kind: 'operation',
    owner:
      'Achats conserve engagement et liens de lignes. WMS conserve réception physique et mouvements de stock.',
    requires:
      'Commande confirmée ouverte, produit Catalogue relié au WMS dans la même unité, site et emplacements actifs. Droits purchasing.read/manage et wms.read/manage, WMS activé.',
    trigger:
      'Ouvrir Réceptions et reliquats depuis une commande, saisir les quantités réellement arrivées puis confirmer la réception physique.',
    data: 'Chaque ligne reçue pointe vers sa ligne de commande et sa ligne WMS. Référence du bon, article, emplacement et unité conservés.',
    effect:
      'Une réception WMS validée, ses mouvements et les liens fournisseur sont enregistrés atomiquement. Le reçu et le restant sont recalculés à la lecture; les livraisons partielles se cumulent.',
    noEffect:
      'Confirmer ou clôturer le PO ne crée pas de stock. Réceptionner ne clôture pas le PO, ne paie rien et ne rapproche pas une facture. Aucune sur-réception ni réception de prestation.',
    recovery:
      'Après une réponse perdue, reprendre la même demande conservée. Une commande déjà réceptionnée ne s’annule plus; clôturer le reliquat exige un motif. Retours fournisseur et rattachement de réceptions anciennes restent à développer.',
  },
  {
    id: 'wms-transport',
    from: 'wms',
    to: 'transport',
    title: 'Préparation d’une expédition',
    kind: 'operation',
    owner: 'WMS exécute la préparation; Transport garde l’expédition et son dispatch.',
    requires:
      'Une expédition dont l’origine est le même entrepôt que la préparation, et les accès nécessaires aux écrans des deux modules.',
    trigger: 'Créer une préparation liée à l’expédition, puis compléter le picking.',
    data: 'Identifiant d’expédition et emplacement d’origine; l’état de préparation est dérivé des préparations liées.',
    effect:
      'La complétion du picking retire les quantités WMS. Le transport peut lire ce contexte de préparation.',
    noEffect:
      'Créer le lien ne réserve pas le stock, ne dispatch pas le chargement et ne change pas le statut de l’expédition. La préparation ne bloque pas automatiquement le dispatch.',
    recovery:
      'Si la quantité manque, corriger le stock/dossier puis revalider. Ne pas recréer une préparation avant d’inspecter la première après une réponse incertaine.',
  },
  {
    id: 'yard-transport',
    from: 'yard',
    to: 'transport',
    title: 'Chargement attendu à la cour',
    kind: 'context',
    owner:
      'Cour gère le passage, le quai et la visite; Transport reste propriétaire du chargement.',
    requires:
      'Même entreprise, site et sens compatibles; accès au dossier cible et droit yard.manage.',
    trigger: 'Relier le chargement au rendez-vous ou à la visite.',
    data: 'Référence de dossier consultable. Une visite liée à un rendez-vous utilise les liens du rendez-vous, sans copie.',
    effect: 'L’opérateur comprend quel transport concerne la remorque ou le rendez-vous.',
    noEffect:
      'Aucun coût, statut de livraison ou affectation de chauffeur ne change par ce lien. Positionner un spot sur le plan ne déplace pas une remorque.',
    recovery:
      'Corriger le lien pendant que le passage est ouvert. Une visite terminée est en lecture seule; utiliser les actions Transport pour ses propres transitions.',
  },
  {
    id: 'yard-wms',
    from: 'yard',
    to: 'wms',
    title: 'Quai et dossiers d’entrepôt',
    kind: 'context',
    owner: 'Cour coordonne le quai; WMS garde la réception/préparation et ses mouvements.',
    requires:
      'Réception ou préparation du même site, sens compatible et droits de lecture de la cible.',
    trigger: 'Ajouter le dossier WMS dans les dossiers connectés du rendez-vous/passage.',
    data: 'Identifiant de réception ou préparation, sans duplication des lignes.',
    effect: 'Le quai dispose du contexte entrant ou sortant du travail attendu.',
    noEffect:
      'Arrivée, affectation au quai et départ ne réceptionnent/prélèvent rien automatiquement.',
    recovery:
      'Revenir à la réception/préparation pour valider ses lignes. Corriger un lien ne corrige pas un mouvement déjà posté.',
  },
  {
    id: 'manufacturing-wms',
    from: 'manufacturing',
    to: 'wms',
    title: 'Articles et nomenclatures de fabrication',
    kind: 'reference',
    owner: 'WMS détient les articles; Fabrication décrit les nomenclatures, gammes et ordres.',
    requires:
      'Articles existants ou droit de création rapide, postes/calendriers et gammes adaptés.',
    trigger: 'Choisir ou créer l’article depuis une nomenclature ou un ordre.',
    data: 'La même identité WMS est réutilisée : pas une copie d’article propre à Fabrication.',
    effect: 'Le produit et ses composants deviennent des références du dossier de fabrication.',
    noEffect:
      'Créer un article, une nomenclature ou calculer un planning APS n’est pas une réception ou une consommation physique. Ne pas assimiler Catalogue et WMS sans correspondance explicite.',
    recovery:
      'Vérifier références et unités avant de planifier. Si APS est indisponible, le dossier métier subsiste; cela n’autorise pas à inventer des mouvements de production.',
  },
  {
    id: 'fleet-transport',
    from: 'fleet',
    to: 'transport',
    title: 'Parc partagé et maintenance',
    kind: 'operation',
    owner: 'Transport tient le parc commun; Flotte pilote ses ordres de maintenance.',
    requires:
      'Un véhicule ou une remorque de l’entreprise. Le contexte transport requiert aussi ses droits de planification.',
    trigger: 'Ouvrir puis démarrer/clôturer un ordre de maintenance sur l’actif.',
    data: 'Identité de l’actif, ordre de maintenance et état opérationnel.',
    effect:
      'Le workflow peut placer l’actif en maintenance. La clôture le libère seulement s’il est encore en maintenance et qu’aucun autre ordre ouvert ne le retient.',
    noEffect:
      'Un actif retiré n’est jamais réactivé ainsi. Une date d’échéance n’est pas une réservation d’atelier. Une intervention Services n’est pas un ordre Flotte.',
    recovery:
      'Examiner les autres ordres ouverts si l’actif n’est pas libéré. Ne pas forcer son état pour masquer une maintenance inachevée.',
  },
  {
    id: 'transport-billing',
    from: 'transport',
    to: 'billing',
    title: 'Coût exécuté et audit de fret',
    kind: 'operation',
    owner: 'Transport fige le coût du chargement terminé; Facturation rapproche les pièces reçues.',
    requires: 'Chargement concerné et coût enregistré, facture transporteur et droits Billing.',
    trigger: 'Créer/rapprocher une facture entrante ou ouvrir son audit de fret.',
    data: 'Coût attendu et détail capturés sur le chargement, lignes facturées, tolérances et résultat de rapprochement.',
    effect:
      'Le moteur calcule les écarts et expose les litiges éventuels. La résolution suit le workflow financier.',
    noEffect:
      'Ni le tracé de la carte, ni un nouveau tarif ne recalculent le coût historique d’un transport terminé. Un rapprochement ne signifie pas paiement.',
    recovery:
      'Ouvrir/résoudre le litige dans Facturation. Préserver le coût attendu historique; ne pas le remplacer pour faire disparaître artificiellement l’écart.',
  },
  {
    id: 'portal-transport',
    from: 'customer-portal',
    to: 'transport',
    title: 'Vue client et demandes de changement',
    kind: 'context',
    owner: 'Transport garde les dossiers; le portail fournit une vue limitée au client autorisé.',
    requires:
      'Module et accès portail actifs, client correctement lié. Les liens publics et comptes nommés ont des portées distinctes.',
    trigger:
      'Le client ouvre une commande ou soumet une demande; le personnel examine la file des demandes.',
    data: 'Projection du dossier du client, suivi prévu et demande persistée, pas les données des autres clients.',
    effect:
      'Le personnel dispose d’une demande traçable à traiter avec les actions métier adéquates.',
    noEffect:
      'Déposer une demande ne modifie pas automatiquement une expédition ou un chargement. Une invitation n’est pas un mot de passe partagé.',
    recovery:
      'Vérifier le résultat et la décision dans la file staff avant de modifier le transport. Révoquer séparément les accès ou liens concernés si nécessaire.',
  },
  {
    id: 'sites-crm',
    from: 'sites',
    to: 'crm',
    title: 'Formulaire publié et capture commerciale',
    kind: 'configured',
    owner: 'Sites garde la soumission; CRM garde le contact et son appartenance à une liste.',
    requires:
      'Page publiée, champs de capture et liste CRM configurés; vérifier le résultat avec une soumission de test.',
    trigger: 'Une personne soumet le formulaire public.',
    data: 'Champs du formulaire et contact identifié/créé selon le parcours de capture; liste cible si configurée.',
    effect:
      'La soumission est conservée; l’enrichissement CRM/liste est best-effort et doit être contrôlé.',
    noEffect:
      'Aucun projet Services, client TMS, devis accepté ou compte portail n’est créé par simple soumission.',
    recovery:
      'Si le contact/liste manque, inspecter d’abord la soumission conservée et la configuration. Ne pas demander au prospect de soumettre à répétition.',
  },
  {
    id: 'crm-catalog',
    from: 'crm',
    to: 'catalog',
    title: 'Société CRM et partenaire métier',
    kind: 'reference',
    owner: 'CRM et Catalogue possèdent encore des fiches distinctes.',
    requires:
      'Catalogue et CRM activés, catalog.read/manage et crm.read; Billing et lecture facture client pour le lien financier.',
    trigger:
      'Catalogue → Partenaires → Connexions : sélectionner explicitement la société CRM et le client de facturation.',
    data: 'Identifiants tenant-scopés, relation unique par cible et version de la fiche partenaire; pas de copie des contacts.',
    effect:
      'Les fiches restent distinctes mais leur correspondance est vérifiée. Si CRM possède déjà un client de facturation, Catalogue doit utiliser le même.',
    noEffect:
      'Le même nom ou courriel ne crée pas une relation fiable. Une opportunité gagnée n’est pas encore un projet Services.',
    recovery:
      'Relire les connexions après une réponse incertaine. Un client utilisé dans l’historique de facturation Services ne se remplace plus; traiter explicitement les doublons.',
  },
  {
    id: 'procurement-transport',
    from: 'procurement',
    to: 'transport',
    title: 'Sourcing transport et guide de routage',
    kind: 'reference',
    owner:
      'Achats transport suit les appels d’offres; Transport fournit corridors et transporteurs.',
    requires:
      'Corridors et transporteurs préparés, droits d’achat transport et revue des résultats.',
    trigger: 'Préparer un appel d’offres et examiner les préférences du guide de routage.',
    data: 'Références transport et propositions de service/tarif pour les corridors concernés.',
    effect:
      'Les équipes disposent d’un contexte de sourcing utilisable dans leur processus transport.',
    noEffect:
      'Ce n’est pas l’application Achats fournisseurs de produits. Un résultat d’appel d’offres n’est pas un mouvement WMS ni un paiement.',
    recovery:
      'Contrôler les règles du guide et la validité du transporteur avant utilisation dans une opération réelle.',
  },
  {
    id: 'agents-analytics',
    from: 'agents',
    to: 'analytics',
    title: 'Décisions des agents et supervision',
    kind: 'context',
    owner:
      'Agents exécute les outils autorisés; Analytics lit les runs, propositions, tâches et audits.',
    requires: 'Runtime par entreprise pour agir; permissions Analytics pour consulter ses vues.',
    trigger:
      'Un agent est réveillé, consulte un outil ou propose/exécute une action selon sa politique.',
    data: 'Runs durables, propositions et traces disponibles; ratios calculés à la lecture.',
    effect: 'La supervision permet de suivre réussites, échecs, approbations et interruptions.',
    noEffect:
      'Un résumé IA n’est pas une preuve de mutation. Seuls les outils enregistrés existent; aucun nouvel outil Services de consommation ou d’approbation n’est livré ici.',
    recovery:
      'Vérifier le résultat métier et l’historique avant de relancer. Pause coupe les sessions; l’autonomie ne supprime jamais les plafonds ni les permissions.',
  },
  {
    id: 'connect-transport',
    from: 'connect',
    to: 'transport',
    title: 'Échanges API et webhooks',
    kind: 'configured',
    owner: 'Connect gère les accès et livraisons; Transport valide les opérations reçues.',
    requires:
      'Clé de portée minimale ou webhook authentifié, cible/mapping pris en charge, environnement externe de test.',
    trigger: 'Un événement est émis ou un système externe appelle un point d’entrée configuré.',
    data: 'Payload défini par le contrat de l’API ou le format du webhook, pas toute la base du tenant.',
    effect:
      'Les webhooks sortants passent par une file durable. Les entrées réutilisent les opérations métier prises en charge.',
    noEffect:
      'Configurer une connexion n’active pas toutes les synchronisations. Une erreur de livraison n’annule pas forcément l’opération source.',
    recovery:
      'Inspecter le journal et le résultat cible avant replay. Distinguer rejet métier, échec de livraison et réponse perdue pour éviter les doublons.',
  },
  {
    id: 'crm-emails',
    from: 'crm',
    to: 'emails',
    title: 'Relances et transport des messages',
    kind: 'configured',
    owner:
      'CRM choisit déclencheurs et destinataires; le transport de messagerie assure l’envoi configuré.',
    requires:
      'Connecteur actif, identité d’envoi, canal et destinataires vérifiés. Tester sans vrais destinataires.',
    trigger: 'Une action explicite ou une automatisation commerciale configurée demande un envoi.',
    data: 'Destinataire, contenu du gabarit et contexte autorisé par le canal.',
    effect:
      'L’envoi suit le transport configuré et son historique. Un pilote log journalise seulement.',
    noEffect:
      'Un message journalisé n’est pas un courriel livré/lu. Configurer un pipeline ne prouve pas que le SMS ou courriel externe fonctionne.',
    recovery:
      'Vérifier le pilote, la connexion et le journal. Ne pas relancer en masse une campagne dont le résultat de livraison est incertain.',
  },
  {
    id: 'documents-transport',
    from: 'documents',
    to: 'transport',
    title: 'Pièces jointes du dossier transport',
    kind: 'context',
    owner:
      'Documents assure le stockage et l’accès; le dossier métier décide de l’usage de la preuve.',
    requires: 'Dossier et permissions de fichiers adaptés; stockage configuré.',
    trigger: 'Téléverser ou consulter une pièce attachée au dossier.',
    data: 'Fichier, catégorie et référence métier autorisée.',
    effect: 'La pièce est disponible dans son contexte avec contrôle d’accès.',
    noEffect:
      'Téléverser un fichier ne termine pas automatiquement une livraison et n’approuve pas une facture. Documentation est le manuel, pas cet espace de fichiers.',
    recovery:
      'Corriger la pièce dans son parcours prévu puis effectuer explicitement l’action métier. Ne pas déduire un statut d’un nom de fichier.',
  },
];

export const BUSINESS_JOURNEYS = [
  {
    id: 'quality-correction',
    title: 'Contrôler une fabrication et vérifier sa correction',
    modules: ['quality', 'manufacturing'],
    steps: [
      [
        'Plan qualité',
        'Définir les consignes, un critère visuel et une mesure avec unité et bornes incluses.',
      ],
      [
        'Contrôle',
        'Choisir l’ordre de fabrication existant, décrire l’objet et créer le contrôle. Ses critères sont copiés et le dossier source reste inchangé.',
      ],
      [
        'Résultats',
        'Démarrer avec un motif, saisir tous les résultats, enregistrer puis terminer. Un échec crée une non-conformité dans la même transaction.',
      ],
      [
        'Correction',
        'Analyser la cause et enregistrer l’action corrective. Déclarer sa réalisation puis vérifier avec un compte rendu pour clôturer. Un nouveau contrôle peut documenter la contre-mesure; aucun stock n’est libéré.',
      ],
    ],
  },
  {
    id: 'after-sales-service',
    title: 'Traiter une demande SAV avec une intervention',
    modules: ['catalog', 'support', 'services'],
    steps: [
      [
        'Catalogue',
        'Identifier le client actif. Sa référence sera conservée sur la demande SAV et sur le projet Services.',
      ],
      [
        'SAV',
        'Créer la demande, décrire le problème et sa priorité, puis qualifier En traitement avec un motif.',
      ],
      [
        'Services',
        'Préparer ou retrouver une intervention du même client, puis la relier depuis SAV. Effectuer le travail, déclarer le temps et les pièces dans leurs parcours existants.',
      ],
      [
        'SAV',
        'Vérifier le résultat et résoudre avec un compte rendu. Rouvrir si nécessaire ou clôturer définitivement après contrôle. Cette décision ne termine pas automatiquement l’intervention.',
      ],
    ],
  },
  {
    id: 'field-service',
    title: 'Réaliser une intervention avec pièces',
    modules: ['catalog', 'services', 'wms'],
    steps: [
      [
        'Catalogue',
        'Créer le client et la prestation. Créer le produit GOODS, puis établir sa correspondance Stock WMS dans la même unité.',
      ],
      [
        'Entrepôt',
        'Réceptionner réellement les pièces dans un emplacement actif. La création des fiches ne crée aucune quantité.',
      ],
      ['Services', 'Activer le projet client, affecter et démarrer l’intervention.'],
      [
        'Pièces et stock',
        'Confirmer la sortie de 2 EA de joints depuis le bon emplacement. Vérifier la ligne conservée et le mouvement WMS.',
      ],
      [
        'Feuilles de temps',
        'Déclarer et soumettre le temps; une personne indépendante habilitée approuve la version.',
      ],
      [
        'Clôture',
        'Terminer avec un compte rendu puis clôturer le projet une fois toutes les heures approuvées/annulées. La facture Services reste une prochaine étape, non générée.',
      ],
    ],
  },
  {
    id: 'warehouse-delivery',
    title: 'Préparer un transport et son passage au quai',
    modules: ['wms', 'transport', 'yard'],
    steps: [
      ['Transport', 'Identifier l’expédition et son entrepôt d’origine.'],
      [
        'Entrepôt',
        'Créer la préparation liée au même site. Vérifier et compléter les lignes pour sortir le stock.',
      ],
      [
        'Cour',
        'Relier la préparation et/ou le chargement au rendez-vous compatible; enregistrer l’arrivée et l’affectation au quai.',
      ],
      [
        'Transport',
        'Effectuer explicitement les transitions de dispatch et livraison; elles ne viennent pas du simple lien de quai.',
      ],
      [
        'Contrôle',
        'Vérifier séparément stock, passage et livraison. Trois dossiers connectés gardent trois états métier distincts.',
      ],
    ],
  },
  {
    id: 'supplier-followup',
    title: 'Acheter et recevoir en plusieurs arrivages',
    modules: ['catalog', 'purchasing', 'wms'],
    steps: [
      [
        'Catalogue',
        'Préparer un fournisseur actif et relier les produits physiques aux articles WMS dans la même unité.',
      ],
      [
        'Achats fournisseurs',
        'Créer les lignes, contrôler quantité/prix/devise puis confirmer le bon.',
      ],
      [
        'Entrepôt',
        'À l’arrivée physique, ouvrir Réceptions et reliquats depuis le PO. Choisir entrepôt, emplacements et quantités réellement reçues; confirmer pour créer et valider la réception WMS liée.',
      ],
      [
        'Contrôle',
        'Contrôler reçu et restant par ligne. Enregistrer chaque nouvel arrivage. Clôturer explicitement; un solde non livré exige un motif et ne crée pas de stock.',
      ],
    ],
  },
];
export const CONNECTION_GLOSSARY = [
  [
    'Référence',
    'Identifiant pointant vers une fiche partagée. Deux noms ou codes identiques ne constituent pas une référence.',
  ],
  [
    'Instantané (snapshot)',
    'Copie de certaines valeurs au moment d’une opération : les pièces conservent leur unité et leur nom, les achats leurs libellés. Renommer la fiche ne réécrit pas cette copie.',
  ],
  [
    'Lien de contexte',
    'Relation qui aide à comprendre un dossier sans exécuter ses actions : relier un rendez-vous à une réception ne réceptionne rien.',
  ],
  [
    'Mouvement',
    'Événement réel du registre de stock, enregistré avec son effet sur les soldes. Une erreur se corrige par un autre mouvement traçable, pas en effaçant la sortie.',
  ],
  [
    'Disponible',
    'Quantité observée à la lecture. Ce n’est pas une réservation; un autre opérateur peut agir avant votre confirmation.',
  ],
  [
    'Version',
    'Date technique de la dernière modification. Une action sur une ancienne version est refusée pour éviter d’écraser le travail d’un collègue.',
  ],
  [
    'Clé d’opération',
    'Identité conservée d’une demande. Reprendre exactement cette clé et son contenu permet au serveur de reconnaître une action déjà réussie.',
  ],
  [
    'Best-effort',
    'Traitement secondaire qui peut échouer sans annuler le dossier principal. Exemple : une soumission Sites peut exister même si son ajout à une liste CRM a échoué.',
  ],
];
