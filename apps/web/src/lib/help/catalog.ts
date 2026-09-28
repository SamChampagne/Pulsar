export interface PageGuide {
  purpose: string;
  steps: string[];
  connections: string;
  caution?: string;
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  '/billing/ledger-qualification': {
    purpose:
      'Reprendre la devise d’un historique manuel, paiement, facture ou groupe de dotations rapprochées avec une preuve et une décision humaine, sans modifier les lignes originales.',
    steps: [
      'Sélectionner une écriture sans devise originale. Contrôler la synthèse source : paiement et contrepassation, facture et avoirs clients, ou toutes les dotations enregistrées d’une immobilisation.',
      'Conserver un justificatif PDF, PNG ou JPEG de 10 Mo maximum, avec une description. Le fichier et son empreinte sont conservés; un dépôt ne valide pas la devise.',
      'Avec billing.ledger.qualify, choisir la devise explicite, la preuve et un motif détaillé. Préparer la revue, vérifier les lignes et les effets puis confirmer.',
      'Pour corriger une qualification, la retirer avec motif et preuve avant de confirmer une nouvelle devise. Toutes les décisions restent conservées.',
      'Immobilisation historique : vérifier cumul et périodes puis attester explicitement la devise sur preuve. Toutes les dotations sont qualifiées ou retirées ensemble. Aucun mois absent ni journal manquant n’est créé; le plan futur reste bloqué. Les droits de lecture Immobilisations sont requis aussi pour les preuves et reprises.',
      'Un paiement garde sa devise source; la décision couvre aussi sa contrepassation. Retirer le rapprochement bancaire avant de modifier sa qualification. Accès au paiement requis aussi pour ses preuves.',
      'Pour un paiement partiellement affecté, comparer déclaré, affecté/comptabilisé et reste. Seule la portion déjà postée entre dans la qualification; aucun crédit, avance ou montant complémentaire n’est créé. Le rapprochement bancaire reste bloqué.',
      'Une facture garde sa devise source. Vérifier net, taxes figées, total et avoirs; la qualification couvre ensemble les écritures historiques NULL. Un avoir à devise connue interdit le retrait isolé. La reprise ne crée jamais de journal manquant. Droits de lecture de la facture requis, y compris sur preuves et reprises.',
      'Facture transporteur ajustée : comparer lignes attendues, reçues et payable accepté. L’historique doit contenir une acceptation ACCEPT_INVOICED unique, cohérente avec le rapprochement, et le journal doit déjà correspondre au payable. Les taxes figées ne sont pas recalculées et aucun journal manquant n’est créé. Sans décision ou avec des écarts incohérents, le dossier reste bloqué.',
      'Après coupure, vérifier la confirmation ou reprendre exactement la même demande. La preuve en attente exige le même fichier; ne pas créer une nouvelle clé.',
    ],
    connections:
      'Finance seul suffit. Grand livre, balance, résultats, bilan, flux et écarts budgétaires utilisent la qualification actuellement confirmée et signalent les écritures historiques incluses. Les périodes anciennes reflètent la connaissance actuelle, pas celle de l’époque.',
    caution:
      'Aucune conversion, réécriture, contrepassation ou clôture. Un retrait remet l’écriture dans les exclusions des rapports. Une pièce jointe et son hash ne certifient pas sa véracité ni une conformité fiscale.',
  },
  '/billing/fixed-assets': {
    purpose:
      'Suivre une immobilisation dans sa devise, valider son plan exact et enregistrer les dotations réellement comptabilisées.',
    steps: [
      'Nouvelle immobilisation : code, nom, référence, devise, coût, résiduel, date d’acquisition, premier mois, durée et comptes actifs. Le compte de charge est de type Charge; le cumul est de type Actif.',
      'Ouvrir : examiner les mensualités complètes, sans prorata journalier. Les cumuls linéaires sont arrondis au centime; leur différence donne chaque dotation. Modifier reste possible sur le brouillon.',
      'Figer et activer demande confirmation et conserve le plan exact. Ses montants, dates, devise et comptes ne sont ensuite plus modifiables.',
      'Comptabiliser uniquement la prochaine période arrivée à fin de mois UTC, avec billing.assets.post. Une dotation nulle est tracée sans écriture GL. Après coupure, reprendre la même demande conservée.',
      'Retirer du suivi demande un motif et conserve l’historique. Les anciens dossiers sans devise restent en lecture seule, sans plan ou devise inventés.',
    ],
    connections:
      'Finance seul suffit. Chaque dotation positive est liée à une écriture équilibrée du grand livre, puis aux rapports et budgets de cette devise. Le lien journal exige le droit de lecture GL. Reprise du journal permet de qualifier ensemble les anciennes dotations sur preuve, sans réactiver le plan futur. Aucun besoin de Transport, Flotte ou WMS; le profil comptable ne modifie pas le plan.',
    caution:
      'Le retrait n’est pas une cession comptable. Aucun posting d’acquisition, prorata fiscal, conversion, réévaluation, clôture de période ni contrepassation dans ce parcours. Le registre ne prouve pas à lui seul une comptabilité complète.',
  },
  '/billing/accounting-profile': {
    purpose:
      'Choisir le rôle comptable cible de Pulsar pour votre entreprise, sans activer une comptabilité officielle ou un connecteur.',
    steps: [
      'Choisir Pulsar natif ou un logiciel externe de référence; nommer ce logiciel si nécessaire.',
      'Choisir la devise fonctionnelle cible et expliquer la décision. Le droit billing.accounting.configure est distinct de la saisie comptable.',
      'Confirmer puis consulter les révisions. Après coupure, reprendre la même demande conservée.',
    ],
    connections:
      'Le grand livre reste en devises de transaction. Les budgets capturent leurs propres devise et période; un changement de profil ne les modifie pas.',
    caution:
      'Pas de conversion, migration historique, synchronisation externe ni clôture activée par ce choix.',
  },
  '/billing/budgets': {
    purpose:
      'Prévoir des montants par compte et les comparer aux écritures d’une devise sur une période figée.',
    steps: [
      'Nouveau budget : nom, année de début, devise, dates civiles inclusives et comptes actifs distincts. Chaque montant accepte au plus deux décimales.',
      'Confirmer : devise et période deviennent immuables. Modifier révise le nom, les lignes ou le statut actif; décocher actif archive sans supprimer.',
      'Consulter : lire les exclusions, les écarts budget moins réalisé et les révisions conservées. Les vingt dernières révisions sont affichées.',
      'Un historique non qualifié reste en lecture seule : créer explicitement un nouveau budget. Une réponse incertaine se reprend avec la demande conservée.',
    ],
    connections:
      'Finance autonome. Comparaison calculée depuis le grand livre, uniquement pour les comptes du budget. Le profil comptable et les réglages fiscaux futurs ne déplacent pas les dates capturées.',
    caution:
      'Aucun change ou bénéfice total inféré. Un écart positif n’est pas toujours favorable. La couverture partielle n’est pas une comptabilité officielle.',
  },
  '/billing/ledger': {
    purpose:
      'Consulter les comptes et écritures, contrôler une balance par devise et enregistrer une écriture manuelle définitive.',
    steps: [
      'Journal : filtrer par source, période ou devise; Sans devise retrouve les écritures historiques non qualifiées.',
      'Balance : choisir explicitement une devise. Lire le nombre d’écritures incluses et exclues avant les totaux.',
      'Nouvelle écriture : date civile, devise, comptes et montants positifs au débit ou au crédit. Les totaux doivent être identiques au cent près; confirmer explicitement.',
      'Après réponse incertaine : Vérifier l’écriture ou Reprendre la même écriture. La clé et les montants conservés ne doivent pas être remplacés.',
    ],
    connections:
      'Les nouvelles approbations de factures client/transporteur, avoirs clients et paiements portent la devise de leur source. Le registre des factures fournisseur générales reste documentaire et n’alimente pas ce journal.',
    caution:
      'Aucun change, consolidation ou verrou de période. Un équilibre arithmétique ne prouve pas que toutes les pièces sont comptabilisées; les auto-postings existants restent best-effort. Reprise du journal qualifie l’historique manuel, les paiements et les factures cohérentes sur preuve et rapprochement source, avec leurs écritures compensatoires. Pour un paiement partiel, seule la portion affectée et déjà comptabilisée est qualifiée; le reste demeure hors journal et la banque reste bloquée. Anciens actifs et sources incohérentes restent exclus, sans backfill.',
  },
  '/billing/reports': {
    purpose:
      'Lire des vues de contrôle exactes dans une seule devise de transaction, sans additionner CAD et USD.',
    steps: [
      'Choisir la devise avant le rapport et sa période; la borne finale inclut toute la date civile UTC.',
      'Contrôler la portée affichée : autres devises et historique sans devise sont exclus. Consulter le journal pour examiner les écritures non qualifiées.',
      'Les âgés clients et transporteurs montrent les soldes actuels classés par ancienneté d’approbation. Changer la date de classement ne reconstruit pas une balance historique.',
    ],
    connections:
      'Bilan, résultats et flux lisent le grand livre. Les âgés lisent les factures et leurs règlements courants. L’échéancier fournisseur général est un autre registre opérationnel, sans dette comptabilisée.',
    caution:
      'Pas encore de devise fonctionnelle, taux ou écarts de change, clôture, états consolidés ni ancienneté par échéance contractuelle. Ne pas utiliser ces vues partielles comme états officiels.',
  },
  '/billing/supplier-schedules': {
    purpose:
      'Répartir le reste documentaire des factures fournisseur qualifiées sur des dates convenues, sans comptabiliser une dette ni enregistrer de règlement.',
    steps: [
      'Choisir une date de référence et les filtres, puis Appliquer. Les prévisions couvrent tous les résultats filtrés, séparés par devise.',
      'Planifier ouvre la facture source. Ajouter jusqu’à 60 dates civiles distinctes en ordre croissant; répartir exactement son total moins les avoirs qualifiés. Reprendre la date de la facture reste un choix explicite.',
      'Renseigner le motif, Examiner les effets, vérifier les dates et montants puis Confirmer la révision avec le droit de gestion des échéanciers.',
      'À revoir signifie qu’un nouvel avoir a changé le reste : l’ancienne révision reste visible mais sort de la prévision. Corriger explicitement la répartition et confirmer à nouveau.',
      'Retirer le planning conserve son historique. Après une coupure, Vérifier la demande ou Reprendre la même confirmation; ne pas créer de doublon.',
    ],
    connections:
      'Finance seul suffit. Factures et avoirs qualifiés sont des sources figées; liens directs vers la facture originale et le dossier fournisseur. Lecture par billing.supplier-invoices.read, confirmation humaine par billing.supplier-schedules.manage.',
    caution:
      'Date dépassée ne signifie pas impayé. Aucun paiement, solde bancaire, conversion de devise, posting comptable ou relance automatique. La date de référence classe le planning courant; ce n’est pas une balance historique. Zéro couvert par avoirs ne signifie pas payé.',
  },
  '/billing/suppliers': {
    purpose:
      'Réunir les documents reçus d’un fournisseur, sans confondre qualification documentaire et dette comptable.',
    steps: [
      'Rechercher un fournisseur actif ou historique, puis ouvrir son dossier.',
      'Lire la synthèse qualifiée par devise : elle couvre tout l’historique, même quand la liste est filtrée.',
      'Choisir type, statut, devise ou dates civiles, puis Appliquer. Ouvrir un document retrouve sa facture et son avoir précis.',
      'Dans Pièces justificatives, distinguer original sélectionné et pièces complémentaires; télécharger via l’accès Finance protégé.',
    ],
    connections:
      'Fournisseur du référentiel partagé, factures et avoirs du registre Finance. Les noms historiques restent figés. Les contextes Achats/WMS se lisent seulement depuis leurs documents avec les droits correspondants.',
    caution:
      'Aucun montant payable, comptabilisation, paiement ou stock ici. Le reste documentaire exclut les règlements; pas de conversion entre devises. Les relevés transporteur sont un registre distinct.',
  },
  '/wms/stock-exits': {
    purpose:
      'Documenter la destruction/le rebut ou le retour physique au fournisseur d’une quantité précise, sans libérer artificiellement un lot bloqué.',
    steps: [
      'Préparer : choisir article suivi, lot et emplacement, quantité et motif. Pour un retour, choisir le fournisseur partagé et renseigner son autorisation et la destination confirmée.',
      'Avec Achats et son droit de lecture, rattacher facultativement une réception enregistrée du même fournisseur/article/lot/site/unité. La quantité encore rattachable tient compte des brouillons non annulés; ce n’est pas une réservation physique.',
      'Le brouillon ne réserve et ne retire rien. En cas d’erreur, annuler avec un motif et préparer un nouveau dossier.',
      'Examiner les effets : stock courant, quantité retirée, solde restant et disposition. Tout nouveau mouvement du lot exige une nouvelle revue.',
      'Après l’opération physique, saisir le compte rendu et confirmer explicitement. Consulter la preuve de stock depuis le dossier fermé.',
      'Après réponse perdue, reprendre la même demande conservée. Ne pas créer un second dossier pour compenser une réponse incertaine.',
      'Conserver des PDF, PNG ou JPEG (10 Mo maximum, 30 pièces). Après coupure, vérifier l’enregistrement ou resélectionner exactement le même fichier. Un ajout après sortie est identifié comme tel, sans réécriture de la preuve de stock.',
      'Après un retour enregistré, ouvrir Suivi chez le fournisseur. Choisir un justificatif et saisir les cumuls reçus, acceptés et refusés, la date du constat, sa référence et son compte rendu. Une baisse exige un motif; les versions précédentes restent consultables. Après coupure, vérifier ou reprendre la même déclaration.',
    ],
    connections:
      'WMS seul suffit. Fournisseur partagé avec Achats, mais aucune commande obligatoire. Un rattachement explicite capture la ligne et son prix d’achat; seuls les lecteurs Achats peuvent consulter cette copie. Le journal revient au dossier source; la quarantaine du reste du lot est inchangée.',
    caution:
      'Confirmation par utilisateur interne avec wms.manage et wms.stock.dispose ou wms.stock.return. Aucun avoir, remboursement, email, shipment ou réception fournisseur automatique. Compte rendu textuel, pas une signature ou un certificat réglementaire. Pas d’annulation après sortie enregistrée.',
  },
  '/wms/cycle-counts': {
    purpose:
      'Comparer le stock physique d’un emplacement avec une copie figée, article par article et lot par lot.',
    steps: [
      'Démarrer sur un emplacement calme. Les mouvements ne sont pas réservés ou bloqués par le comptage.',
      'Compter toutes les lignes, avec zéro explicite. Si un scan identifie plusieurs lots, choisir celui en main.',
      'Enregistrer la saisie sans toucher au stock, vérifier les écarts, puis réconcilier explicitement.',
      'Stock bougé : annuler et recompter. Réponse de réconciliation perdue : actualiser le dossier, ne pas renvoyer à l’aveugle.',
    ],
    connections:
      'La réconciliation écrit des ajustements par lot dans le journal, avec son dossier source. Les écarts alimentent le Workbench, sans action automatique de stock par un agent.',
    caution:
      'Les anciens comptages sans instantané sécurisé restent consultables/annulables, mais ne peuvent plus ajuster le stock. Un article ou lot inattendu se traite par identification et ajustement explicites avant un nouveau comptage.',
  },
  '/wms/items': {
    purpose:
      'Définir les articles de stock et, pour les nouveaux articles suivis, leur registre de lots.',
    steps: [
      'Choisir le suivi par lot à la création : ce choix ne change plus ensuite.',
      'Ouvrir Lots pour relever numéro, lot fournisseur et dates déclarées; créer la fiche ne crée pas de stock.',
      'Sélectionner le lot dans les réceptions, mouvements et préparations; consulter son journal depuis la fiche.',
      'Ouvrir Traçabilité du lot, choisir amont/aval puis une carte pour les dossiers directs; consulter les limites et contrepassations signalées.',
    ],
    connections:
      'Achats sélectionne le même lot lors de l’arrivée physique. Solde du lot, total Inventaire et mouvement restent atomiques.',
    caution:
      'Dates informatives sans FEFO. Quarantaine manuelle sur tout le lot, libération documentée avec droit distinct. Aucun stock libéré automatiquement par Qualité. Traçabilité bornée par liens atelier vérifiés : pas de séries, allocation par pièce ou rappel réglementaire complet. Une préparation ou un shipment lié ne prouve pas une livraison.',
  },
  ...Object.fromEntries(
    [
      'services',
      'support',
      'purchasing',
      'fleet',
      'yard',
      'billing',
      'procurement',
      'customer-portal',
    ].map((module) => [
      `/${module}/data`,
      {
        purpose:
          'Créer et entretenir les références utiles à cette application sans activer un autre module pour ses données de base.',
        steps: [
          'Choisir le type de fiche et rechercher avant de créer pour éviter les doublons.',
          'Ajouter ou modifier la fiche. Elle devient utilisable immédiatement dans les formulaires de cette application.',
          'Pour Services et Achats, utiliser les connexions explicites Facturation ou Stock WMS seulement si la cible est activée et autorisée.',
        ],
        connections:
          'Les fiches appartiennent au socle partagé : modifier une fiche met à jour la même identité dans les modules qui la consomment. Catalogue est un éditeur central facultatif.',
        caution:
          'Aucune fusion par nom, mouvement de stock, transition de maintenance ou facture depuis cet écran. Après une réponse incertaine, rechercher et vérifier la fiche avant de réessayer.',
      },
    ]),
  ),
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
  clients: {
    purpose:
      'Entretenir les fiches client partagées, les coordonnées et les adresses de facturation et de livraison dans une application facultative.',
    steps: [
      'Choisir le registre Transport et facturation ou Services et SAV, puis rechercher le client avant de créer.',
      'Ouvrir Dossier 360° : choisir une section autorisée, rechercher un dossier puis suivre son lien exact. Les compteurs incluent tous les statuts; les règles et actions restent dans les modules sources.',
      'Compléter les coordonnées et saisir séparément les deux adresses. Copier une adresse est une action explicite, pas un lien permanent.',
      'Ouvrir Carnet pour ajouter plusieurs adresses et interlocuteurs. Définir leur fonction, leur période de validité et le motif; retrouver les versions dans Historique.',
      'Adapter les colonnes et leur largeur; désactiver une fiche devenue inutile plutôt que perdre son historique.',
    ],
    connections:
      'Mêmes identifiants et writers que les espaces Données. Chaque module continue à gérer ses clients sans activer Clients. Les correspondances Services vers Facturation restent explicites.',
    caution:
      'Pas de fusion automatique entre registres, de création de site, de recalcul fiscal ou de remplacement des coordonnées de documents historiques. Les deux adresses sont des références, pas un manifeste ni une preuve de livraison.',
  },
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
      'Créer un contrôle indépendant, ou choisir une réception WMS validée, un lot, un ordre de fabrication ou une demande SAV. Démarrer, saisir les résultats et les enregistrer avant de terminer. Un lot est figé dès la création; mouvement ou nouvelle décision impose un nouveau contrôle.',
      'Un contrôle terminé avec un échec ouvre une non-conformité. Analyser sa cause, documenter la correction et vérifier son efficacité avant clôture. Le journal conserve chaque décision.',
    ],
    connections:
      'WMS, Fabrication et SAV restent propriétaires des sources. La fiche lot permet de préparer un contrôle et de citer son résultat conforme dans une libération humaine séparée, avec preuve figée et droits WMS/Qualité.',
    caution:
      'Aucun blocage/libération automatique, suivi unitaire par série, certification, signature ou outil AI Qualité. WMS seul conserve la libération manuelle. Une saisie vide ne vaut jamais conforme.',
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
      'Préparer fournisseur et articles dans Données; Catalogue est facultatif. Ajouter les conditionnements et références utiles à la fiche article.',
      'Créer un brouillon avec ses lignes, quantités, prix unitaires et devise.',
      'Confirmer, puis ouvrir Réceptions et reliquats : sélectionner les quantités réellement arrivées et leur emplacement WMS. Répéter pour les livraisons partielles, puis clôturer; un reliquat exige un motif.',
    ],
    connections:
      'Données Achats et Catalogue partagent les mêmes fiches. Le conditionnement choisi est capturé sur la ligne; chaque arrivage physique confirmé utilise le lien WMS explicite et actualise le reliquat. Les appels d’offres transport restent distincts.',
    caution:
      'Confirmer ne transmet aucun courriel. Clôturer ne réceptionne pas de stock et ne crée ni facture ni paiement.',
  },
  services: {
    purpose:
      'Organiser le travail client en projets, affecter les interventions et suivre les heures déclarées avec leur compte rendu.',
    steps: [
      'Choisir un client ou le créer dans Services → Données, puis créer le projet. Avant activation, choisir si l’acceptation des travaux est exigée. Le module Catalogue n’est pas obligatoire.',
      'Activer le projet, planifier une intervention et choisir son intervenant. Consulter le contrôle RH du jour de début, vérifier le fuseau et adapter manuellement si nécessaire. Le filtre « Mes interventions » retrouve vos affectations.',
      'Démarrer l’intervention. Dans Pièces et stock, choisir le produit relié au WMS, l’emplacement et le lot si suivi, puis confirmer les pièces réellement utilisées. Retourner une quantité conserve le lot et l’emplacement d’origine : sorties, retournées et conservées restent visibles. Seules les quantités conservées deviennent facturables; un brouillon existant doit être supprimé avant correction. Déclarer puis soumettre les heures et faire approuver par un autre responsable habilité.',
    ],
    connections:
      'Les référentiels clients, prestations et produits sont partagés et accessibles dans Services → Données, sans Catalogue ni Achats obligatoires. WMS tient les quantités totales et par lot des pièces consommées/retournées. Pour une pièce déjà facturée, préparer et valider un avoir dans Facturation, puis le sélectionner lors du retour physique dans Services; ni stock ni remboursement automatique. Accès fournit les utilisateurs; les heures se consolident par intervention et projet. Une affectation n’accorde aucun droit.',
    caution:
      'La clôture exige des interventions fermées et des temps approuvés ou annulés. Si configurée, l’acceptation des interventions terminées est aussi requise avant clôture et facturation de leurs sources. Onglet Acceptation : réponse client consignée et historique, pas de signature électronique ni validation des prix. Les temps du projet fermé restent en lecture seule. Aucun temps, même approuvé, ne génère automatiquement de facture.',
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
      'Dans l’atelier d’un ordre démarré, déclarer les quantités réelles par lot source et le lot produit. Relire ensuite la preuve matières → produit, distincte du planning.',
      'Pour une erreur de saisie, examiner et confirmer une contrepassation complète avec motif, puis saisir la déclaration correcte. L’historique est conservé; le stock et les quantités actives sont compensés ensemble.',
    ],
    connections:
      'Les articles et lots appartiennent au WMS; la déclaration atelier conserve leurs preuves et écrit les mouvements dans une seule transaction. Le rebut ne crée aucun stock. La planification dépend du moteur APS, mais ne déclenche aucune production.',
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
      'Factures fournisseur : saisir le document reçu, conserver son original puis qualifier explicitement le dossier. Fonctionne avec Finance seul; aucun paiement ni écriture automatique.',
      'Configurer devises, taxes et paramètres comptables.',
      'Préparer ou rapprocher une facture.',
      'Vérifier puis approuver avant de suivre le paiement.',
      'Pour un avoir validé, ouvrir Document et envoi client : confirmer les identités, figer le PDF, le vérifier puis confirmer séparément la simulation ou l’envoi SMTP.',
    ],
    connections:
      'Les coûts de transport terminés restent figés. Les liens entre factures, paiements et banque assurent la traçabilité. Dans une facture client validée, Avoirs et solde client permet une correction motivée : préparer un brouillon, vérifier ses taxes figées et confirmer avec le droit dédié. Un avoir réduit le dû; un retour de pièces Services et un remboursement sont des actions distinctes.',
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
