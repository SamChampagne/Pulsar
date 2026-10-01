import { MODULE_GUIDES, PAGE_GUIDES } from './catalog';
import type { PageGuide } from './catalog';
import type { NavDomain } from '$lib/modules/navigation';
import { MODULE_CONNECTIONS } from './connections';

export interface KnowledgeArticle extends PageGuide {
  key: string;
  title: string;
  prerequisites: string;
  rules: string[];
  limits: string[];
  example: string;
  links: { href: string; label: string }[];
}
interface Detail {
  prerequisites: string;
  rules: string[];
  limits: string[];
  example: string;
}
export const KNOWLEDGE_DETAILS: Record<string, Detail> = {
  clients: {
    prerequisites:
      'Activer Clients et attribuer clients.read; clients.manage autorise les modifications. Aucun module Transport, Catalogue ou Services n’est requis pour entretenir les fiches.',
    rules: [
      'Communications ouvre un panneau dans cette fiche : canal, destinataire choisi explicitement, autorisation opérationnelle avec preuve, modèle et aperçu. Le journal reste propre à cette identité; les messages des interventions/opportunités/expéditions se consultent dans leur dossier source. core.communications.read et le droit du canal complètent les droits de la fiche. Aucun module métier supplémentaire imposé.',
      'Le registre Transport et facturation utilise Customer. Services et SAV utilisent BusinessPartner avec le rôle client. Le même nom ne constitue jamais une correspondance; aucun dossier historique n’est fusionné.',
      'Dossier 360° ouvre les projets, interventions, devis, demandes SAV, factures clients, opportunités et commandes CRM, commandes Transport. Les sections sont autorisées par le module activé ET son droit de lecture des documents, avant toute requête ou compteur. Lire une fiche ou les paiements ne donne pas accès aux factures. La vue existe aussi dans les espaces Données et les fiches CRM/Catalogue, sans imposer Clients.',
      'Le dossier utilise une seule correspondance explicite actuelle : partenaire vers client de facturation ou société CRM, société CRM vers client, et lectures inverses. Client vers partenaire vers CRM n’est pas un lien direct. Rapprochement affiche et gère séparément ces correspondances; aucun nom, ancien montant ou snapshot documentaire ne sert à reconstruire une identité.',
      'Les compteurs du Dossier 360° incluent tous les statuts et restent indépendants de la recherche dans la section. Recherche et pages sont traitées côté serveur. Ouvrir une ligne mène au dossier source exact et ses règles; les dates affichent le fuseau utilisateur. Actualiser relit les liens et documents courants. Une erreur n’est jamais remplacée par zéro.',
      'Dans le Carnet, Documents liés montre les brouillons utilisant cette entrée/version et les copies engagées conservées. Compteurs, types et liens sont limités aux modules activés et à vos droits de lecture. Un résultat vide ne prouve pas une absence d’usage ailleurs. Les anciennes fiches sans capture et les autres identités ne sont jamais rapprochées implicitement.',
      'La facturation et la livraison par défaut sont indépendantes : rue, complément, ville, région, pays et code postal. Un formulaire incomplet est refusé; les formats Canada/États-Unis sont contrôlés, mais aucune délivrabilité postale n’est garantie.',
      'Effacer une adresse ne supprime ni site ni ancien document. Copier facturation vers livraison remplace seulement le brouillon affiché; les modifications suivantes ne se propagent pas entre les deux.',
      'Les éditeurs de fiches partagées utilisent la dernière version lue. Une édition concurrente impose de recharger. Les anciens clients API Customer sans version restent compatibles.',
      'Carnet ouvre les adresses et contacts multiples de cette identité. Nom, fonction libre, coordonnées, notes, début inclusif et fin exclusive sont configurables. Le jour de comparaison est affiché et modifiable; la désactivation conserve la fiche et ses versions.',
      'Chaque modification du carnet exige un motif et la version lue. La version avant changement reste consultable dans Historique. Une réponse perdue se reprend avec la même demande conservée dans cet onglet; pas de nouvel envoi automatique.',
      'Le carnet est commun à Clients, Transport, Facturation, Services, SAV, Achats fournisseurs et à l’administration interne du Portail, selon leurs propres droits. Clients n’est pas requis. Un contact n’est ni un utilisateur, ni une affiliation autorisant le portail; les rôles libres ne donnent aucun droit.',
      'Devis Services et factures clients : le panneau Coordonnées du document choisit explicitement une adresse de facturation, une adresse de livraison/intervention et un contact. Il copie une version du carnet, pas un lien qui suivrait silencieusement ses changements. Les anciennes adresses par défaut ne sont pas copiées automatiquement.',
      'Les colonnes et largeurs sont propres au compte, à l’entreprise, au tableau et au navigateur. Masquer un champ n’enlève aucun droit serveur. Nom et actions restent visibles; la vue peut être réinitialisée.',
      'Le fuseau utilisateur est enregistré dans les préférences du compte. Un choix vide suit l’appareil. Les instants des helpers communs sont convertis avec leur décalage; une date civile reste la même. Les plannings métier conservent leur propre fuseau explicite.',
    ],
    limits: [
      'Dossier 360° est une navigation en lecture seule, pas une balance, un calcul de rentabilité, une fusion historique ni un moteur de prochaines actions. Aucun total monétaire, pièce jointe ou note privée n’est projeté. Un résultat vide ne prouve pas l’absence de dossiers dans un module inaccessible. Les factures liées historiquement à un autre client et les liens indirects restent dans leurs sources.',
      'Le carnet ne remplace pas encore les adresses par défaut : aucune double synchronisation implicite. Pas de choix automatique sur les commandes, de personne globale entre entreprises, de révocation d’accès liée à une fin de validité, de fusion des registres, de crédit partagé ni de dossier financier consolidé.',
      'Les adresses de référence ne préremplissent pas encore tous les documents. Aucun compte client fiscal, moteur de taxes transfrontalières ou connecteur ISAAC actif n’est fourni par cet espace.',
    ],
    example:
      'Créer le client facturable, saisir son bureau de Montréal pour la facturation et son entrepôt américain pour la livraison. Vérifier la fiche partagée depuis Facturation; un transport existant conserve ses lieux et sa tarification.',
  },
  hr: {
    prerequisites:
      'Activer Ressources humaines. hr.read consulte tous les dossiers; hr.read + hr.manage gère le référentiel et les demandes pour autrui; hr.read + hr.approve décide; hr.self ouvre uniquement son espace personnel. Prévoir au moins deux personnes habilitées pour valider des demandes créées par un gestionnaire.',
    rules: [
      'Compétences et habilitations : le code et la nature du référentiel sont fixes. Les attestations exigent hr.read + hr.qualifications.manage, un employé et une compétence actifs, une référence vérifiée et des dates inclusives. Une autre personne autorisée doit attester ou révoquer la qualification liée à votre compte.',
      'Une attestation ne se modifie pas : le renouvellement crée une nouvelle ligne. Révoquer est définitif, motivé et audité; aucune réactivation. Une référence ou un employé inactifs ne couvrent plus les exigences de Fabrication, même si la période affichée reste valide.',
      'Fabrication définit jusqu’à 30 exigences par poste. Avec manufacturing.read et hr.qualifications.read, le contrôle ponctuel renvoie seulement la couverture par exigence. Toutes doivent être couvertes à la date demandée; aucune exigence définie n’est jamais assimilée à une qualification.',
      'Les tables RH sont distinctes des comptes Accès et des heures Services. Le dossier employé contient uniquement matricule, prénom, nom, poste, équipe et compte facultatif. Créer un employé ne crée pas de login ni de permission.',
      'Matricule et code équipe sont uniques par entreprise et fixes. Un compte interne actif ne peut être associé qu’à un seul employé. Le lien utilisateur est fixé à la création dans ce lot; un dossier sans compte peut néanmoins recevoir des demandes créées par un gestionnaire.',
      'Une équipe inactive ne peut pas être sélectionnée. Sa désactivation est refusée tant qu’elle contient des employés actifs. Désactiver un employé conserve ses dossiers, sans désactiver son compte de connexion.',
      'Les absences ont leur numéro ABS, un employé immuable, un type, une période et une note professionnelle. Les dates début/fin sont incluses, réelles et comprises entre 1900 et 2199; au maximum 366 dates civiles par demande. Aucun jour ouvrable, solde ou droit légal n’est calculé.',
      'Cycle : Brouillon → À approuver → Approuvée ou Refusée. Une soumission peut revenir au brouillon; un refus aussi. Une annulation est définitive. Une période et son type ne peuvent être modifiés qu’au brouillon d’un employé actif.',
      'Approuver, refuser et annuler une approbation exigent hr.approve et une autre personne : ni le bénéficiaire identifié par son compte ni le créateur de la demande ne peuvent décider. L’espace personnel ne propose jamais ces décisions.',
      'À la soumission et à l’approbation, aucune autre demande soumise/approuvée du même employé ne peut chevaucher la période, bornes incluses. Les brouillons, refus et annulations ne réservent rien. Le contrôle est sérialisé côté serveur.',
      'Un employé avec une demande soumise ou une absence approuvée finissant aujourd’hui ou plus tard (jour UTC) ne peut être désactivé. Traiter ou annuler les dossiers avant sa désactivation. Un brouillon restant ne peut plus être modifié ou soumis si le dossier est inactif.',
      'Les décisions et modifications gardent auteur, date et avant/après dans un journal RH transactionnel. Une version périmée est refusée. L’audit général conserve l’identité de l’opération et le statut, pas les motifs ni les dates d’absence.',
      'La création conserve une clé dans le navigateur liée à l’auteur et au contenu. Après une réponse perdue, reprendre exactement la demande conservée. Après une modification ou décision incertaine, relire le dossier et son historique avant de réécrire.',
      'hr.self est vérifié à chaque endpoint : seuls le dossier relié au compte connecté, ses demandes et son historique sont lisibles. hr.read est un droit étendu à toutes les données RH de l’entreprise; le réserver aux personnes habilitées.',
      'hr.availability.read est distinct de hr.read et hr.self : avec services.read et les deux modules activés, il révèle seulement si une absence approuvée couvre le jour demandé. Ni les motifs, types, intervalles complets, numéros, ni les identifiants de dossiers RH ne sortent de RH. Ce droit permet de vérifier les autres personnes du tenant; le réserver aux planificateurs autorisés.',
    ],
    limits: [
      'Pas de paie, cumul de congés, droit du travail automatisé, planning horaire, demi-journées, calendrier légal, recrutement ou pièces jointes RH. Les habilitations restent des attestations internes : aucune signature réglementaire ni vérification externe automatique.',
      'Aucune intégration AI RH, notification, export paie, synchronisation d’annuaire ou décision automatique. Ne pas saisir de diagnostic, numéro d’assurance sociale, salaire ou coordonnées bancaires dans les notes.',
      'La liste des interventions garde son contrôle minimal du jour de début. Le planning Services ajoute une durée, un fuseau d’entreprise, les conflits, absences et exigences sur tout le créneau. Aucun remplacement automatique ni réservation de machine Fabrication. Les heures réalisées restent dans Services.',
      'La réaffectation du compte lié à un employé, les politiques de conservation/anonymisation et les accès hiérarchiques par équipe nécessitent des lots dédiés avant un déploiement RH sensible.',
      'Le contrôle Fabrication ne réserve pas d’opérateur, ne lit pas les absences et ne bloque pas les opérations. Le résultat utilise les révocations actuelles, même pour une date passée : ce n’est pas une reconstitution historique des autorisations.',
    ],
    example:
      'Créer l’équipe Atelier, puis Camille avec un compte interne existant et hr.self. Camille ouvre Mes absences, prépare les 12 et 13 octobre et soumet. Alex, muni de hr.read + hr.approve, vérifie puis approuve avec un motif. Camille voit la décision, sans accès aux demandes des collègues. Le gestionnaire doit encore adapter manuellement le planning Services.',
  },
  quality: {
    prerequisites:
      'Activer Qualité et attribuer quality.read pour consulter, quality.read + quality.manage pour agir. Pour relier un dossier, activer aussi WMS, Fabrication ou SAV et accorder son droit de lecture.',
    rules: [
      'Le code du plan est unique par entreprise et immuable. Une modification ou désactivation incrémente la version. Les nouveaux contrôles ne sélectionnent que les plans actifs.',
      'Un plan contient 1 à 30 critères identifiés par une clé stable. Une mesure exige une unité et deux bornes finies comprises entre −1 milliard et +1 milliard. Les bornes sont inclusives; aucun arrondi ou changement d’unité n’est appliqué.',
      'Chaque contrôle possède son numéro QC, un objet, la copie du plan et au plus un dossier source. Les critères, consignes et version sont copiés à la création : changer le plan ne change jamais ces copies.',
      'Cycle : À préparer → En contrôle → Terminé. Annulation possible avant la fin. Démarrer, terminer et annuler exigent un compte rendu. Seul un contrôle en cours reçoit des résultats.',
      'Les valeurs manquantes restent non renseignées. La terminaison exige tous les critères. Une mesure hors bornes ou une réponse Non conforme suffit à produire un échec. Aucun utilisateur ni agent ne choisit manuellement le résultat global.',
      'Terminer un contrôle échoué crée exactement une non-conformité NC dans la même transaction. Un contrôle conforme n’en crée aucune. Les résultats terminés sont immuables : une contre-vérification nécessite un nouveau contrôle.',
      'Non-conformité : À analyser → En traitement → Action réalisée → Vérifié et clôturé. Cause et action doivent être enregistrées avant de déclarer la réalisation. Une action réalisée peut revenir En traitement; une clôture est définitive.',
      'Chaque décision conserve auteur, date, motif et valeurs avant/après dans le journal transactionnel commun. Les versions périmées sont refusées. Le gestionnaire qui traite peut aussi vérifier : pas de contrôle indépendant forcé dans cette version.',
      'Une non-conformité non clôturée accepte un responsable interne actif et une échéance civile facultatifs. Mes dossiers filtre par le compte connecté; Sans responsable par absence d’affectation; Échéance dépassée exclut les clôtures et compare au jour UTC, sans notification automatique.',
      'Les justificatifs appartiennent à la non-conformité : maximum 30 fichiers de 10 Mo, PDF/PNG/JPEG avec signature de format vérifiée. Ils ne sont pas supprimables depuis le dossier. La clôture empêche tout nouvel ajout, mais leur consultation reste possible avec quality.read.',
      'Les preuves passent par le stockage Documents, mais leur liste, téléchargement et métadonnées sont réservés au module Qualité. Un droit core.documents.read/manage ne suffit pas. La reprise d’un upload conserve sa clé et exige de rechoisir exactement le même fichier après rechargement.',
      'La création d’un contrôle conserve une clé liée à son auteur et au contenu. Après une réponse perdue, reprendre exactement cette demande. Pour un enregistrement ou une décision incertaine, recharger et vérifier le journal avant toute nouvelle écriture.',
      'Un lien source est immuable et respecte l’entreprise et les droits. Une réception doit déjà être validée; un ordre de fabrication ou un SAV peut être à tout état. Le lien n’atteste donc pas que la production ou le service est terminé.',
      'Un contrôle de lot choisit le lot dès la création, depuis Qualité ou Articles → Lots → Préparer un contrôle. Identité article/lot, état de quarantaine, révision et compteur de mouvements sont capturés. Aucun rattachement après coup d’un ancien résultat. Pour terminer, WMS et wms.read restent requis; tout mouvement, même un aller-retour net zéro, ou nouvelle décision impose d’annuler le contrôle ouvert et d’en préparer un autre.',
      'Un contrôle terminé et conforme peut être cité lors d’une libération WMS humaine, avec wms.manage, wms.lots.release et quality.read. Même lot, version exacte du contrôle, même quarantaine et aucun mouvement depuis sa préparation sont revérifiés. La décision conserve le résumé du contrôle au moment de la libération, sans changer le résultat historique.',
    ],
    limits: [
      'Les liens restent explicites, sans déclenchement automatique. La fiche lot liste ses inspections et ses préparations WMS ouvertes; pas de rappel aval transitif. Le détail source est masqué si le module ou son droit de lecture manque; le titre libre saisi dans Qualité reste visible aux lecteurs Qualité.',
      'Qualité ne bloque ni ne libère automatiquement le stock. WMS seul conserve sa libération manuelle avec compte rendu, sans Qualité obligatoire. Un contrôle de réception ou d’OF ne vaut pas contrôle d’un lot précis. Aucun plan d’échantillonnage statistique, signature, certification ou contrôle métrologique. La vérification du format des preuves ne constitue pas une analyse antivirus.',
      'Les plans sont génériques, sans correspondance directe à un produit Catalogue ni héritage automatique dans les nomenclatures. Les unités sont explicites, mais non converties.',
      'Aucun coût de non-qualité, retour fournisseur, remboursement, notification ou outil AI. Fermer une non-conformité ne corrige ni le stock ni le SAV ni la fabrication. Le responsable reste un utilisateur Accès, sans exposition de son dossier RH.',
    ],
    example:
      'Plan Contrôle pièce : aspect conforme et diamètre de 9,8 à 10,2 mm. Créer un contrôle lié à l’ordre de fabrication, démarrer, mesurer 10,4 mm puis enregistrer. Terminer ouvre une NC. Documenter le réglage de la machine, déclarer l’action réalisée, vérifier une nouvelle pièce et consigner la preuve dans le motif de clôture. Le contrôle initial reste non conforme; la contre-mesure peut faire l’objet d’un nouveau contrôle.',
  },
  support: {
    prerequisites:
      'Activer SAV et attribuer support.read/manage. Créer les clients dans SAV → Données ou depuis le sélecteur de la demande, sans Catalogue. Relier une intervention exige aussi Services activé et services.read.',
    rules: [
      'Le responsable est un utilisateur interne actif, jamais un compte technique ou un agent. Responsable et échéance se modifient sur un dossier ouvert/en traitement. Les files Mes demandes à traiter, Sans responsable et Échéances dépassées excluent les résolutions et clôtures; le retard compare la date civile au jour UTC, avant pagination.',
      'Chaque demande possède son numéro SAV, son client immuable, un titre, une description et une priorité. Une priorité est un tri humain, pas un engagement de délai.',
      'Cycle : À qualifier → En traitement → Résolu → Clôturé. Une demande résolue peut être rouverte En traitement. Une demande clôturée est définitive.',
      'Chaque transition exige un compte rendu ou motif. Les modifications sont limitées aux demandes ouvertes/en traitement; une version périmée est refusée.',
      'L’historique conserve acteur, date et décision dans la même transaction. La résolution précédente reste lisible après réouverture.',
      'Une intervention liée doit appartenir au même client et à la même entreprise. Le client du projet ne peut pas être changé tant que ce lien existe. Ce lien ne crée, ne démarre et ne termine aucun travail Services.',
      'La création conserve une clé avant envoi. Après une réponse perdue, reprendre la demande conservée. Pour une modification ou décision incertaine, vérifier le dossier et son historique avant toute nouvelle action.',
    ],
    limits: [
      'Pas de boîte de réception client, portail de tickets, pièces jointes SAV, attribution d’équipe, SLA, garanties ou avoirs automatisés dans cette première version.',
      'Aucun envoi de courriel, mouvement de stock, facture ou outil AI SAV. Les demandes restent internes; le journal paginé conserve les décisions.',
    ],
    example:
      'Un client signale une pompe défectueuse : créer la demande, la qualifier, relier l’intervention de diagnostic du même client, consigner la solution puis clôturer après vérification.',
  },
  sites: {
    prerequisites:
      'Module Sites activé et droits sites.read/manage; contenu relu avant publication.',
    rules: [
      'Une page commence comme brouillon. La publication est une action explicite qui rend son contenu public.',
      'Les blocs et formulaires déterminent ce qui est présenté et collecté. Vérifiez les champs et leur destination avant publication.',
      'Les soumissions peuvent alimenter la capture commerciale; elles ne créent pas automatiquement un compte client ni une commande.',
      'Les liens, images et boutons doivent être testés dans l’aperçu puis dans la page publiée.',
    ],
    limits: [
      'Une page de capture n’est pas une boutique ecommerce complète : panier, paiement et fulfillment ne sont pas ajoutés par ce lot.',
    ],
    example:
      'Préparez une page de demande de service, contrôlez le formulaire et sa destination CRM, puis publiez la page.',
  },
  documentation: {
    prerequisites:
      'Aucun réglage : ce centre est accessible à tous les utilisateurs internes connectés.',
    rules: [
      'Les articles disponibles suivent vos applications et vos permissions. Un article ne donne aucun droit supplémentaire.',
      'Le tutoriel se présente automatiquement une seule fois par module, pour votre utilisateur dans votre entreprise. Cette première présentation est enregistrée immédiatement : ni un rechargement, ni un retour, ni une nouvelle version ne le relancent automatiquement. L’aide « ? » permet de le relancer volontairement.',
      'Les guides officiels sont livrés avec le logiciel. Ils ne contiennent pas vos pièces jointes ni vos mots de passe.',
    ],
    limits: [
      'La rédaction de procédures privées par entreprise et leur validation éditoriale sont prévues dans un prochain lot.',
      'Une visite guidée explique les contrôles; elle ne crée aucun faux dossier et ne valide aucune opération à votre place.',
    ],
    example:
      'Cherchez « stock », ouvrez Entrepôt et consultez ses règles avant de lancer une réception.',
  },
  catalog: {
    prerequisites:
      'Activer Catalogue et attribuer catalog.read pour consulter, catalog.manage pour écrire.',
    rules: [
      'Fiche article sépare Identification, Dimensions par unité et Consignes pour les produits; les prestations proposent Périmètre, Livrables et Exclusions. Les mesures positives sont saisies en mm et kg, par unité du catalogue. Aucune capacité, réservation, conversion de stock ou règle fiscale n’est déduite de ces informations privées.',
      'Dans Conditionnements, un produit peut avoir plusieurs formats : 1 carton = 12 EA, par exemple. Code, contenu exact, code-barres et règle colis entiers/fractions sont fixes; seuls libellé et activation sont modifiables avec une version. Pour changer le contenu, créez une nouvelle fiche. Le code-barres conserve ses zéros et sa casse, et reste réservé dans ce registre même après désactivation. Les prestations n’ont pas de conditionnements.',
      'Références fournisseurs : une référence par article et fournisseur, avec prix exact, devise, minimum, multiple, délai indicatif, dates de validité UTC, conditionnement et consignes. Une nouvelle version ne réécrit pas les commandes confirmées. Les prix d’achat ne sont pas exposés par la façade Services ni par les résumés des sélecteurs.',
      'Le code est unique par entreprise. Une fiche peut être corrigée ou désactivée, jamais supprimée par cette interface.',
      'Un partenaire doit être client, fournisseur ou les deux. Les nouvelles commandes ne sélectionnent que les fournisseurs actifs; les projets, que les clients actifs.',
      'Produits et prestations partagent une identité, pas un stock. Le type, le code et l’unité sont immuables après création pour éviter de réinterpréter les dossiers existants.',
      'Les modifications concurrentes sont refusées : rechargez la fiche si un collègue l’a changée.',
      'Catalogue est un espace central facultatif, pas une activation obligatoire pour Services, SAV ou Achats. Leurs espaces Données donnent accès aux coordonnées utiles avec les droits du module consommateur. Leurs sélecteurs restent limités aux noms, codes et unités nécessaires.',
    ],
    limits: [
      'Les anciens clients TMS, sociétés CRM, produits CRM et articles WMS ne sont ni copiés ni fusionnés automatiquement.',
      'Seuls les produits GOODS peuvent être reliés explicitement à un article WMS actif de même unité via Stock WMS. Les sociétés/produits CRM et clients Transport restent séparés. Un code identique ne crée pas de lien.',
      'Les codes-barres des conditionnements servent aux réceptions de commandes Achats ayant capturé ce format. Ce n’est pas le registre global des scans WMS : aucun décodage GS1, lot, série, étiquette ou liaison implicite par code. Les formats imbriqués et conversions kg/L ne sont pas pris en charge.',
    ],
    example:
      'Créez « Inspection annuelle » comme prestation en heures, puis sélectionnez-la dans une intervention. Un même partenaire peut aussi fournir des pièces dans Achats.',
  },
  purchasing: {
    prerequisites:
      'Activer Achats fournisseurs avec purchasing.read/manage. Préparer fournisseurs et articles dans Achats fournisseurs → Données ou directement depuis le formulaire. Catalogue est facultatif.',
    rules: [
      'Dans Données → Articles → Fiche article, complétez la fiche technique puis Références fournisseurs. Ces données sont partagées avec Catalogue, mais Achats seul suffit. Prix, minimum et multiple portent toujours l’unité de l’article. Un emballage descriptif ne convertit jamais automatiquement des boîtes en pièces.',
      'Conditionnements ajoute un contenu structuré distinct du texte d’emballage. Sur une ligne, choisissez le format et son nombre puis Appliquer le conditionnement : 2 cartons × 12 EA = 24 EA commandées. Le prix reste par EA, pas par carton. La conversion doit être exacte à quatre décimales; aucun arrondi ni changement d’unité implicite. Saisir en unités de base retire le format et conserve la quantité pour revue.',
      'Le serveur capture le conditionnement à l’enregistrement et revalide version/activité à confirmation. Une modification bloque le brouillon jusqu’à resélection. Après confirmation, la copie reste figée, même si le format du catalogue est renommé ou désactivé. Les anciennes commandes restent en unités de base sans copie inventée.',
      'Sur une ligne, Appliquer ces conditions choisit explicitement la référence et sa version, recopie le prix et affiche les conditions. Aucun fournisseur ni tarif n’est choisi automatiquement. Le minimum et le multiple sont contrôlés exactement, sans arrondi; le prix et la devise doivent correspondre. Passer en prix manuel retire ce choix mais conserve le prix saisi pour le revoir.',
      'À l’enregistrement puis à la confirmation, la référence doit être active et valide à la date UTC courante affichée par ses bornes. Une version modifiée bloque la confirmation jusqu’à un nouveau choix. Le délai est indicatif : renseignez séparément la date attendue. Les consignes ne calculent ni paiement ni taxe. Les copies confirmées restent figées, même après désactivation du tarif.',
      'Carnet fournisseur : adresses et contacts versionnés, disponibles dans Achats fournisseurs → Données ou dans une commande via Carnet du fournisseur. Achats fournisseurs seul suffit; aucun client Transport ou société CRM n’est créé.',
      'Documents liés retrouve les versions choisies dans les commandes brouillons et les copies engagées, même clôturées. Une version changée impose une revue du brouillon; la copie engagée reste intacte. Les devis Services du même partenaire ne sont visibles qu’avec Services activé et son droit de lecture. Les achats matières MRP ne font pas partie de cette lecture.',
      'Sur un brouillon enregistré, Coordonnées du document capture explicitement Adresse du fournisseur et Contact fournisseur de la commande avec un motif. Ce sont ses coordonnées, pas votre adresse de facturation ni votre lieu de réception. Aucun destinataire courriel, paiement ou accès portail n’est déduit du contact.',
      'Confirmer revalide rôle fournisseur, activité, identité et versions du carnet au jour d’entreprise affiché. La copie est figée avec le statut dans la même transaction. Une mise à jour du carnet ne réécrit pas l’accord confirmé, clôturé ou annulé. Les anciennes commandes restent sans copie historique inventée.',
      'Pour changer de fournisseur au brouillon, retirez explicitement chaque choix enregistré puis enregistrez le nouveau fournisseur. Une modification concurrente des lignes ou coordonnées exige de relire la commande. Après une réponse incertaine, utilisez Vérifier la commande enregistrée; ne renvoyez pas la confirmation à l’aveugle.',
      'Le numéro PO est attribué automatiquement et reste unique dans l’entreprise.',
      'Un brouillon comporte de 1 à 100 lignes. Chaque quantité est strictement positive et le prix unitaire ne peut pas être négatif.',
      'Chaque commande a une seule devise. Le total hors taxes utilise les quantités et prix, avec un calcul décimal côté serveur.',
      'La confirmation revérifie que fournisseur et articles sont actifs. Les libellés et unités enregistrés sur les lignes sont conservés.',
      'Après confirmation, les lignes ne sont plus modifiables. Réceptions et reliquats enregistre les arrivages physiques; annuler devient interdit après une réception. Une clôture avec produits manquants exige un motif.',
      'Réceptionner exige purchasing.read/manage, wms.read/manage et Entrepôt activé. Chaque produit doit être relié à un article WMS actif de même unité, dans Données → Articles → Stock WMS. Cette correspondance est disponible sans Catalogue. Les prestations restent hors stock.',
      'Un arrivage crée et valide une réception WMS et ses liens de lignes dans la même transaction. Les champs personnalisés de réception WMS sont proposés et validés. Le reçu et le reste sont calculés depuis ces lignes, sans addition de produits ou unités différents. Le dépassement de commande est refusé.',
      'Sur Réceptions, le scan du code-barres capturé retrouve seulement une ligne avec reliquat de cette commande. Il n’ajoute aucune quantité et ne valide rien. Un code ambigu exige un choix manuel. Saisissez le nombre de conditionnements réellement reçus, vérifiez le calcul dans l’unité de stock, choisissez emplacement et référence puis confirmez l’arrivée physique. USB/Bluetooth clavier ou Zebra DataWedge clavier + Entrée/Tab utilisent le même champ dédié; aucun matériel n’a été certifié par ce lot.',
      'Une réception peut utiliser le conditionnement figé ou des unités de base pour un carton ouvert. La conversion doit être exacte à trois décimales WMS et respecter la règle de colis entiers. Le nombre de colis est conservé dans la preuve d’arrivage; le stock reste enregistré en unités de base. Reprendre une réponse perdue conserve aussi exactement ce choix de saisie.',
      'Après une réponse perdue, reprendre la réception conservée avec sa même clé. La commande reste confirmée après réception complète : la clôture administrative est explicite.',
      'Un enregistrement ou une transition utilise la version lue : un changement concurrent provoque un conflit, pas un écrasement.',
    ],
    limits: [
      'La destination de réception et l’identité de votre entreprise acheteuse ne sont pas capturées dans le carnet du fournisseur. Entrepôt et emplacement restent choisis explicitement sur chaque arrivage WMS. Pas encore de PDF fournisseur canonique, d’avenants ni de propagation automatique aux autres documents.',
      'Aucun envoi fournisseur, taxe, facture ou paiement automatique. Seule la confirmation explicite d’un arrivage crée son stock.',
      'Sur un article WMS suivi par lot, choisissez aussi le lot réellement reçu. Son identité et sa péremption déclarée sont distinctes du conditionnement; elles restent visibles dans l’arrivage. Un seul lot par ligne et par arrivage : pour plusieurs lots, enregistrez des arrivages distincts. Retours liés à cette commande ouvre les sorties WMS explicitement rattachées à une réception de cet achat. L’arrivage historique ne diminue pas et aucun avoir n’est déduit du prix capturé. Accusé fournisseur, avoir fournisseur, sur-réception tolérée, séries et rapprochement facture restent à développer. Une ancienne réception WMS indépendante ne se rattache pas automatiquement. Quantités reçues : trois décimales; aucune conversion implicite kg/L.',
      'La clôture signifie uniquement que le suivi administratif est terminé. Ce n’est pas une preuve de réception.',
      'Les achats ne sont pas encore reliés à un projet, une demande MRP ou une réservation de stock.',
    ],
    example:
      'Commander 10 joints, confirmer, recevoir 4 joints via Réceptions et reliquats : reçu 4, restant 6. Réceptionner les 6 suivants dans un nouvel arrivage, ou clôturer le reliquat avec un motif si le fournisseur ne livrera pas le solde.',
  },
  services: {
    prerequisites:
      'Activer Services avec services.read/manage. Créer clients, articles et prestations dans Services → Données ou depuis le sélecteur du formulaire. Ni Catalogue ni Transport ne sont requis; une prestation reste facultative sur une intervention.',
    rules: [
      'Dans une intervention enregistrée, Communications prépare une confirmation ou un suivi à partir des coordonnées du client du projet. Choisissez le destinataire, consignez son accord opérationnel puis relisez l’aperçu. L’envoi ne change ni l’horaire, ni l’affectation, ni l’acceptation des travaux. Sans SMTP tenant actif, ce panneau simule le courriel sans repli plateforme. STOP bloque le SMS; aucun nouvel envoi automatique après résultat incertain.',
      'Devis : choisir un client depuis Services → Données, des articles/prestations et une devise. Accepter le dernier brouillon enregistré fige les lignes et crée un unique projet brouillon, de manière idempotente. Un devis expiré ne peut pas être accepté. Annulation et acceptation sont définitives; aucun envoi ni signature externe.',
      'Dans Services → Données → Carnet, Documents liés retrouve les devis ayant capturé l’entrée. Ouvrir le devis dans un nouvel onglet conserve le contexte du carnet. Les copies acceptées ne réécrivent pas les adresses du projet ni les factures. Les commandes du même partenaire fournisseur exigent leurs propres droits Achats.',
      'Dans un devis enregistré, Coordonnées du document permet de choisir les versions du carnet du client, avec motif. Les entrées doivent être actives et valides au jour d’entreprise affiché. Avant acceptation, une version modifiée, une identité changée ou une entrée expirée oblige à revoir les choix. L’accord conserve ensuite sa copie, même si le carnet change. Retirer les choix est explicite; il faut les retirer avant de changer le client du devis.',
      'Planning : la vue jour/semaine utilise le fuseau d’entreprise (America/Toronto par défaut, réglable dans Mon travail). Le glisser-déposer ouvre un panneau de confirmation. Une version périmée, un chevauchement avec durée connue, une absence approuvée ou des qualifications insuffisantes sont refusés sous verrou, y compris depuis les autres writers d’intervention.',
      'Les exigences de compétences sont propres à l’intervention, éventuellement complétées par celles d’un poste Fabrication. La couverture doit durer tout le créneau. Ce lien ne réserve jamais de capacité APS. Une absence approuvée ou une révocation postérieure peut invalider un planning déjà enregistré : recontrôler avant exécution.',
      'Facturer : ouvrir Services → Données → Clients → Connexions pour choisir ou créer explicitement le client de facturation, avec Facturation activée et ses droits. Catalogue est facultatif. Le lien CRM est facultatif et doit être cohérent avec son client existant. Rien n’est rapproché automatiquement par nom. Le client du projet ne peut plus changer après un devis accepté ou une facturation.',
      'Le panneau Travaux à facturer sélectionne les heures APPROVED facturables et le restant des pièces : quantité sortie moins tous les retours confirmés. Exemple : 4 joints sortis puis 1,25 retourné donnent 2,75 à facturer. Un retour après ouverture de cet écran invalide la sélection : actualisez les sources et reconfirmez les tarifs. Une contrainte unique empêche de facturer deux fois chaque source; une même clé de demande ne crée pas deux factures.',
      'La facture créée est un brouillon dans Facturation, sans taxe implicite, approbation ou envoi. Pour corriger ses pièces : ouvrez la facture depuis l’historique du projet, supprimez le brouillon avec les droits Facturation, confirmez le retour physique dans l’intervention, puis actualisez et préparez une nouvelle facture aux quantités nettes. Le numéro supprimé et sa demande ne sont pas réutilisés; l’historique du projet conserve la trace du brouillon supprimé. Une facture validée reste figée : préparez un avoir motivé dans sa fiche, vérifiez les quantités et taxes puis faites-le valider par une personne ayant billing.credit-notes.approve. Dans Pièces et stock, sélectionnez ensuite l’avoir validé pour confirmer séparément le retour physique. Aucun stock ni remboursement bancaire automatique.',
      'AI : les outils business_attention, services_planning/get_job/check_slot/billable_context et support_case_context lisent les sources autorisées. services_schedule_job et support_set_followup passent par le registre et ProposedAction, avec versions et contrôles métier réévalués. Le rôle Coordinateur Services et SAV est proposé en autonomie PROPOSE, interactif, sans réveil automatique sur ces alertes.',
      'Le projet regroupe le travail pour un client. Il commence en brouillon, passe en cours, puis terminé ou annulé.',
      'Activez un projet avant d’y créer une intervention. Chaque intervention possède son propre numéro INT et son propre état.',
      'Une intervention planifiée peut démarrer ou être annulée. Une intervention en cours peut être terminée ou annulée. Les états fermés sont définitifs dans cette version.',
      'Terminer exige un compte rendu non vide. Sa date de complétion est enregistrée côté serveur. Travail terminé et travaux acceptés sont deux étapes distinctes.',
      'Acceptation : choisir Exiger l’acceptation des travaux sur le projet brouillon, avant activation. Le défaut est facultatif pour préserver les dossiers existants. Le choix ne peut plus changer après activation. Sans Catalogue, Transport, WMS ni Facturation, Services peut toujours consigner les réponses du client.',
      'Dans une intervention terminée d’un projet actif, onglet Acceptation : un humain actif avec services.read et services.work.accept renseigne représentant du client, référence de l’échange et conclusion. Réserves à traiter peut être complété par une nouvelle décision; Travaux acceptés est définitif. L’auteur interne, le compte rendu, le client du projet et les décisions précédentes sont conservés. Il ne s’agit pas d’une signature électronique ni d’une validation des heures, quantités, prix ou taxes.',
      'Si exigée, une acceptation manquante ou des réserves bloquent la nouvelle facture des sources de cette intervention et la clôture terminée du projet. Les autres interventions acceptées peuvent être facturées séparément. Annuler le projet ne fabrique aucune acceptation. La vérification serveur relit les dossiers sous le même verrou que la décision et la facturation; une sélection ancienne ne contourne pas le contrôle.',
      'Après coupure réseau, Reprendre la décision conservée renvoie la même demande, sans nouvel historique. Une acceptation finale ne se retire pas : ouvrez un SAV ou une intervention corrective. Les corrections financières passent par les avoirs existants et les retours physiques restent séparés. Pas de portail client de signature, de fichier de preuve joint ou d’acceptation partielle au sein d’une intervention dans cette version.',
      'Un projet ne peut être terminé ni annulé tant qu’une intervention est planifiée ou en cours. Fermez explicitement les interventions, puis le projet.',
      'L’échéance du projet est une date sans heure. L’heure d’intervention est affichée dans le fuseau du navigateur.',
      'RH → Services : activer les deux modules et attribuer hr.availability.read en plus de services.read; actualiser la session après attribution. La liste vérifie seulement les interventions ouvertes, affectées et datées de sa page. Le panneau prévisualise les champs courants, même avant enregistrement. L’heure de la dernière lecture est affichée; actualiser après une décision RH.',
      'Le contrôle compare le jour civil du début prévu, dans le fuseau affiché du navigateur, aux bornes incluses des absences APPROVED. Brouillons, soumissions, refus et annulations ne déclenchent pas l’alerte. La lecture ne change ni le dossier RH, ni l’intervention, ni les temps de travail.',
      'Aucune absence approuvée ce jour ne veut pas dire disponible. Une personne sans dossier RH, un dossier inactif, un compte non affectable ou un contrôle indisponible est signalé comme non vérifié. Les motifs et détails RH restent invisibles dans Services.',
      'L’intervenant affecté est un utilisateur interne actif de la même entreprise. Une affectation ne donne aucun droit supplémentaire et ne réserve pas sa disponibilité. Le libellé équipe reste une note de coordination.',
      'services.time.write permet de saisir son propre temps sur ses interventions affectées. services.manage permet de saisir pour un autre utilisateur actif et de corriger les temps de l’équipe. services.read est nécessaire dans les deux cas.',
      'Une saisie contient une date sans heure, une durée entière de 1 à 1 440 minutes et une note obligatoire. Le total par personne et par date ne peut dépasser 24 heures dans Services. Le temps peut être ajouté après la fin de l’intervention tant que le projet est actif.',
      'Les temps annulés restent visibles avec leur motif mais sortent des totaux. Le projet fermé fige tous ses temps. Une modification concurrente est refusée; une demande de création conservée se reprend avec la même clé sans double comptage.',
      '« Facturable déclaré » est une classification, pas une approbation ni une facturation. Les totaux tiennent compte de tous les résultats filtrés, pas seulement de la page affichée.',
      'Cycle des heures : À soumettre → À approuver → Approuvé ou À corriger. La saisie est figée pendant la revue; son auteur habilité ou un gestionnaire peut retirer une soumission avant décision.',
      'services.time.approve est distinct de services.manage. L’approbateur doit être un utilisateur interne actif, différent de l’intervenant, de l’auteur initial et de l’auteur de la dernière correction connue. Un administrateur ne contourne pas cette règle.',
      'Demander une correction ou rouvrir une approbation exige un motif. Une réouverture retire les heures du total approuvé, sans effacer la décision précédente. Après correction, une nouvelle soumission et approbation sont nécessaires.',
      'Le journal Historique conserve dans la même transaction acteur, date, état avant/après et version des minutes, note et classement facturable. Deux décisions concurrentes ne peuvent pas valider la même version.',
      'Un projet ne peut désormais être fermé avec des temps à soumettre, à approuver ou à corriger. Les anciennes heures ne deviennent pas approuvées automatiquement; les projets déjà fermés restent en lecture seule.',
      'Pièces et stock consomme un produit GOODS relié au WMS depuis un emplacement actif, uniquement sur une intervention en cours et un projet actif. Il faut services.manage et wms.read/manage, avec Entrepôt activé. La quantité affichée est indicative; elle est revérifiée à la confirmation.',
      'Pour un article suivi par lot, choisissez explicitement le lot après le produit et l’emplacement. Le disponible du lot est distinct du total de l’emplacement; un autre lot ne couvre jamais son manque. Numéro, lot fournisseur et dates déclarées sont capturés sur la consommation. La péremption est informative, sans FEFO ni blocage automatique. Services et Entrepôt suffisent : Catalogue et Achats ne sont pas requis.',
      'Un retour de pièce suivie revient obligatoirement au lot et à l’emplacement de sa sortie, même après modification de la correspondance produit. Aucun changement de lot au retour. L’historique figé reste lisible avec services.read si Entrepôt est désactivé, mais toute nouvelle écriture ou reprise exige encore les droits et modules de stock. Aucun lot n’est déduit pour les anciennes consommations.',
      'La consommation et le mouvement WMS sont atomiques. Un retour intégral ou partiel motivé crée un nouveau mouvement vers l’emplacement d’origine, sans effacer la sortie. Plusieurs retours sont possibles jusqu’à la quantité sortie, à trois décimales maximum. La carte distingue Sorties, Retournées et Conservées; son historique présente les cinq derniers retours, et le journal WMS tous les mouvements. Le retour reste possible après fin de l’intervention tant que le projet est actif; l’emplacement doit être actif et l’unité d’origine inchangée. Le projet fermé fige les pièces.',
      'Chaque retour garde son auteur, sa date, son motif, sa quantité et son mouvement WMS. Après coupure, Vérifier / reprendre renvoie exactement la même quantité et la même clé conservées avant l’envoi, même après fermeture du navigateur. Ne saisissez pas une seconde opération. Deux retours concurrents relisent le restant sous verrou; aucune quantité négative ni retour supérieur à la sortie.',
      'Une intervention avec des pièces non retournées ne peut pas être annulée : retournez-les si elles sont physiquement revenues, ou terminez avec un rapport si elles ont réellement été utilisées. Changer la correspondance Catalogue ne réécrit jamais les pièces passées.',
    ],
    limits: [
      'Pas encore d’approbation par semaine ou en lot, circuit multi-niveaux, relances automatiques, chronomètre, équipe multi-intervenants, optimisation de capacité, forfaits, acomptes ou signature client. Une pièce facturée exige un avoir validé avant retour; quantité physique et quantité autorisée par sa ligne sont contrôlées. Pas de transfert vers un autre emplacement au retour ni de suivi par numéro de série. La reprise après coupure n’est pas un mode hors ligne complet.',
      'Les services utilisent leur propre modèle : une intervention n’est ni une maintenance de flotte ni un ordre de fabrication.',
      'Les agents ne créent pas de facture, n’approuvent pas les heures ou habilitations et n’envoient pas de message client avec ces outils. Les règles d’autonomie peuvent autoriser certaines mutations : conserver PROPOSE pour la recette. Runtime non configuré : les flux déterministes restent utilisables.',
    ],
    example:
      'Affectez une visite à un collègue. Il déclare puis soumet 90 minutes de tests. Un autre utilisateur habilité demande une correction motivée; le collègue corrige et resoumet. Le responsable approuve la version corrigée. Terminez l’intervention avec un rapport, puis clôturez le projet lorsque tous les temps sont traités.',
  },
  dashboard: {
    prerequisites: 'Un compte interne et les accès à vos applications.',
    rules: [
      'Le bureau affiche les applications autorisées. Activer un module ne donne pas automatiquement toutes ses permissions à tous les utilisateurs.',
      'Déplacer une icône ou changer le fond ne modifie pas les dossiers métier.',
      'Les notifications et tâches renvoient au contexte qui les a produites.',
    ],
    limits: ['Le bureau ne propose pas encore deux modules éditables côte à côte.'],
    example:
      'Ouvrez Services depuis le bureau, puis utilisez le sélecteur supérieur pour passer à Catalogue.',
  },
  transport: {
    prerequisites:
      'Clients, transporteurs et lieux; tarifs et corridors si vous utilisez la tarification.',
    rules: [
      'Dans le détail d’une expédition, Communications utilise les coordonnées du client de la commande, jamais les autres arrêts de la tournée. L’opérateur choisit le destinataire et confirme l’aperçu; aucun message ne constitue une preuve de livraison ou un POD. Les messages restent dans l’expédition. Les réponses entrantes ne sont pas rapprochées automatiquement par téléphone.',
      'La commande décrit la demande; les expéditions décrivent les flux; le chargement regroupe les expéditions et leurs ressources.',
      'Carnet → Documents liés retrouve les commandes ayant choisi cette entrée, avec versions et liens directs. Les factures ne sont incluses qu’avec Facturation activée et le droit de lecture des factures clients. Les copies engagées, même terminées, restent conservées; aucune adresse de quai, expédition ou BOL n’est déplacée.',
      'Les changements d’état passent par les actions du dossier. Une édition de texte n’est pas une transition de transport.',
      'Une modification de tarif, distance ou composition du chargement entraîne une réévaluation du coût avant clôture. Le coût d’un chargement terminé reste figé.',
      'Les corridors sont comparés par spécificité. Les tables de carburant sont des surcharges appliquées aux tarifs, pas un journal d’achats de carburant.',
      'Sur la commande brouillon, Coordonnées permet de sélectionner explicitement des versions du carnet du client. La confirmation exige la version revue, recontrôle la validité et fige la copie. Clients et Facturation ne sont pas requis. La lecture du carnet et la gestion des commandes sont nécessaires pour choisir; le lecteur de commande peut consulter la copie.',
      'Les coordonnées commerciales ne remplacent jamais les Locations d’origine/destination, ne changent aucun destinataire et ne sont pas ajoutées au connaissement public du chauffeur. Retirer les choix avant de changer le client d’un brouillon. Les anciens documents sans capture restent sans preuve d’adresse historique.',
      'Les modifications de brouillon et transitions sont contrôlées par statut et version. La planification crée toutes les expéditions et change le statut dans une seule transaction : aucune création partielle ou double planification concurrente. Après une réponse perdue, relire le dossier avant toute nouvelle opération.',
      'Une carte affiche un itinéraire; sa géométrie n’est pas une base de facturation. Une distance manuelle n’est pas remplacée par le routage.',
      'Désactiver un partenaire conserve ses dossiers historiques.',
    ],
    limits: [
      'Remanifestes versionnés, import de cargaisons détaillées et dossiers douaniers restent à développer. Un BOL local n’est pas un accusé douanier. La position GPS ne prouve ni le contenu du camion ni la livraison.',
      'Les POD existants portent signataire, date et notes par expédition. Les réserves structurées, quantités acceptées/refusées et corrections append-only nécessitent un lot dédié.',
      'Les cartes dépendent des coordonnées, tuiles et services de routage configurés.',
      'Les corrections après exécution doivent préserver l’historique; toutes les propriétés d’un dossier fermé ne sont pas éditables.',
    ],
    example:
      'Commande client → expéditions → chargement et tournée → exécution → preuve de livraison → facture.',
  },
  wms: {
    prerequisites:
      'Un lieu de type entrepôt, des articles et des emplacements actifs du même site.',
    rules: [
      'Sorties documentées traite une quantité d’un article suivi, lot et emplacement précis. DRAFT ne réserve ni ne retire rien; annulez et recréez en cas d’erreur. La revue affiche physique, sortie et reste. Tout mouvement du lot ou décision de quarantaine rend une ancienne revue inutilisable. Le responsable confirme la sortie physique avec un compte rendu : journal, soldes et preuve sont atomiques; un POSTED ne se rouvre pas.',
      'Destruction/rebut exige wms.stock.dispose; retour fournisseur exige wms.stock.return, avec wms.read et wms.manage dans les deux cas. La confirmation est réservée aux utilisateurs internes actifs, jamais aux agents. Le lot peut rester en quarantaine : seule la quantité documentée sort, le reste conserve le blocage. Reprendre la même demande conservée après coupure, sans nouvelle clé.',
      'Pour un retour, choisir explicitement un fournisseur partagé actif depuis WMS, saisir référence d’autorisation et destination confirmée. Sa copie est capturée; un fournisseur changé avant sortie exige un nouveau dossier. WMS seul suffit. Aucun rapprochement implicite avec une ligne d’achat, avoir, remboursement, remplacement, email ou transport. La destination et le compte rendu restent déclaratifs.',
      'Rattacher à une réception d’achat est facultatif et exige Achats activé + purchasing.read. Seule une ligne d’arrivage fournisseur POSTED, avec journal cohérent et même fournisseur/article/lot/site/unité, est proposée. Le bac courant peut être différent dans le même entrepôt. Le lien, la quantité reçue, le prix unitaire et la devise sont figés; pas de déduction par nom ni de conversion implicite. Les données commerciales restent cachées aux lecteurs WMS seuls.',
      'Le cumul rattaché comprend les retours DRAFT et POSTED; annuler un brouillon restitue seulement cette capacité documentaire, jamais du stock. Une sélection périmée doit être refaite; la validation physique recontrôle cumul et preuve. Après désactivation d’Achats, les retours autonomes restent possibles mais un retour déjà rattaché exige de rétablir les droits pour être validé. Sa lecture WMS et son annulation restent possibles. Un retour ne diminue jamais les quantités reçues historiques et ne rouvre pas la commande.',
      'Pièces justificatives accepte PDF/PNG/JPEG de 10 Mo maximum, jusqu’à 30 par dossier. Chaque ajout conserve auteur, date, empreinte du fichier et étape DRAFT ou POSTED; ni remplacement ni suppression. Un ajout après sortie ne réécrit pas la preuve initiale ni sa date. Aucun ajout neuf sur CANCELLED. Ces fichiers sont visibles aux lecteurs WMS, jamais par le centre générique de documents; n’y joindre que les informations adaptées à ce public. Signature de format vérifiée, sans antivirus ni certification réglementaire.',
      'Après réponse perdue sur une pièce, Vérifier l’enregistrement retrouve la demande du même utilisateur. Sinon resélectionner exactement le même fichier : nom, type, taille, contenu et clé sont conservés. Seules les métadonnées restent dans le navigateur, pas le fichier. Une erreur de connexion ne justifie pas une nouvelle pièce.',
      'Sur un retour fournisseur POSTED, Suivi chez le fournisseur distingue réception encore attendue et décision encore attendue. Chaque constat donne les cumuls depuis le début, pas une quantité à additionner : reçu ≤ sorti, accepté + refusé ≤ reçu. Exemple : 10 EA sortis, 6 reçus, 4 acceptés et 1 refusé laissent 4 à recevoir et 1 à décider. Ce sont des déclarations de votre équipe, pas une validation électronique du fournisseur.',
      'Consigner un constat exige wms.read/manage et wms.stock.return, un utilisateur interne actif et un justificatif du même retour. WMS seul suffit, même pour le suivi d’un ancien retour lié à Achats; aucune donnée commerciale supplémentaire n’est exposée. Date du constat saisie explicitement en UTC, avec aperçu dans votre fuseau, comprise entre sortie et maintenant; date d’enregistrement distincte. Référence et compte rendu obligatoires. Une baisse de cumul ou une date antérieure exige un motif de correction : la nouvelle version remplace la vue courante, jamais l’historique.',
      'Historique des constats présente auteur, date, cumuls et justificatif par version. Une version périmée est refusée; rechargez puis revoyez les totaux. Après réponse perdue, Vérifier la déclaration ou Reprendre la même déclaration conserve acteur, clé, corps et version attendue après rechargement. Un refus d’accès pendant la reprise ne supprime pas la demande. Les refus fournisseur ne remettent rien en stock; acceptation et reçu ne créent aucun avoir, ne diminuent pas la réception d’achat et ne changent pas la preuve de sortie initiale.',
      'Le journal des mouvements est la source de vérité du stock. Un mouvement et son solde sont enregistrés ensemble.',
      'Les sorties vérifient le stock disponible. Même un ajustement explicite ne peut rendre un emplacement négatif.',
      'Une réception ou préparation est versionnée. Corriger une ligne ne réserve pas de stock : la disponibilité est vérifiée à la validation.',
      'Une zone classe visuellement les emplacements. La renommer ne déplace pas le stock; utilisez Rangement pour un mouvement réel.',
      'Un scan sélectionne un article ou emplacement. Dans un comptage, +1 concerne un brouillon en unités EA, pas le stock publié.',
      'Après une réponse incertaine à un déplacement ou ajustement manuel, reprenez la même opération conservée en haut du WMS : clé, quantité signée et lot restent identiques après rechargement. Ne recréez pas un mouvement supposé manquant. La demande appartient au navigateur, à l’entreprise et à l’utilisateur; ce n’est pas une file hors ligne synchronisée.',
      'Le comptage capture chaque article/lot présent dans l’emplacement et son unité, y compris les soldes connus à zéro. Remplissez toutes les lignes : vide ne vaut jamais zéro. Un scan ambigu demande le lot physique; +1 ne concerne que les EA. Enregistrer clôture la saisie sans stock; Réconcilier poste les seuls écarts non nuls, atomiquement et avec leur dossier source.',
      'Tout mouvement entrant ou sortant de cet emplacement après le démarrage invalide le comptage, même si le total redevient identique. Annulez et recommencez sur un nouvel instantané : aucun recalage automatique des quantités. Après réponse incertaine à une réconciliation, actualisez le dossier avant toute autre action.',
      'Dans Articles, le suivi par lot se choisit définitivement à la création. Les articles existants restent inchangés. Ouvrez Lots pour créer une identité, son numéro fournisseur et ses dates civiles de fabrication/péremption. Ces informations sont immuables; une fiche ne crée aucun stock. Vérifiez l’étiquette avant validation. Après réponse incertaine, relisez le registre avant de recréer.',
      'Réception, préparation, rangement et ajustement demandent le lot explicite d’un article suivi. Les quantités sont contrôlées par lot et emplacement : le stock d’un autre lot ne compense jamais un manque. Divisez une réception ou préparation en lignes distinctes pour plusieurs lots. Une sortie reste revérifiée à la validation, sans réservation.',
      'Lots → Voir les mouvements cible le journal sur ce lot. La liste des lots indique le total de cet article dans tous vos entrepôts; les sélecteurs de sortie filtrent les lots disponibles dans l’emplacement source. Le total Inventaire reste la somme des lots. Achats conserve le lot réellement reçu et le nombre de colis séparément.',
    ],
    limits: [
      'Les dates de péremption sont déclaratives : aucune interdiction automatique ni FEFO. La quarantaine est une décision humaine distincte, pas une certification. Pas de numéros de série, rappel produit ni conversion automatique d’unités. Les liens atelier relient les mouvements d’une même déclaration, sans allocation par pièce; la traçabilité peut parcourir plusieurs déclarations vérifiées.',
      'Depuis Articles → Lots, mettez un lot en quarantaine avec motif : tout son stock, tous sites confondus, est bloqué pour les prélèvements WMS, pièces Services, consommations atelier et ajustements négatifs, comptages et contrepassations compris. Réceptions, retours positifs et déplacements du même lot restent permis sans lever le blocage. Aucun stock n’est créé ou détruit par la décision. Inventaire distingue physique, quarantaine et utilisable.',
      'Libérer après contrôle exige wms.read, wms.manage et le droit distinct wms.lots.release, un motif et le compte rendu du contrôle. Avec Qualité activée et quality.read, choisissez facultativement un contrôle du même lot, terminé et conforme, préparé pendant la quarantaine actuelle sans mouvement depuis. La décision capture sa preuve; celle-ci est masquée sans droit Qualité. L’historique conserve auteur, instant au fuseau utilisateur et révision. Après coupure, reprenez exactement la demande conservée, référence et version comprises. WMS reste autonome : Qualité n’est pas obligatoire et terminer une inspection ne libère jamais ce stock.',
      'Articles → Lots → Préparations à revoir liste les préparations ouvertes portant des lignes de ce lot, tous sites du tenant. Traçabilité du lot parcourt en amont les matières ou en aval les produits : de 1 à 4 niveaux, avec limites explicites, preuves v2 vérifiées et contrepassations exclues. Choisissez une carte pour les réceptions, préparations ou pièces Services de ce lot, paginées et toutes dates confondues. Les retours Services restent visibles. Un shipment lié exige Transport et ses droits; il ne prouve pas une livraison. Aucun changement de dossier, réservation, allocation par pièce ou rappel réglementaire complet.',
      'Services conserve le lot consommé au retour, y compris son blocage courant. Fabrication choisit les lots sources et le lot produit; le journal remonte à l’OF avec les droits Fabrication. MRP, impacts matières et APS matières excluent les quantités en quarantaine. Les nouveaux calculs capturent ce disponible, les anciens restent immuables; la revue APS recontrôle la révision matières avant publication. Aucun choix de lot, réservation ou propagation du blocage aux produits déjà fabriqués.',
      'Les comptages historiques sans copie sécurisée ne sont plus réconciliables : consulter, annuler et recréer si nécessaire. Un lot trouvé mais absent des lignes exige une identification et un ajustement explicites avant un nouveau comptage. Aucun ajout silencieux, gel de stock prolongé ou comptage aveugle dans cette version.',
      'Les douchettes USB/Bluetooth et Zebra DataWedge utilisent la sortie clavier avec Entrée ou Tab. Le matériel réel doit être validé sur site.',
    ],
    example:
      'Recevoir dans une zone de réception, confirmer un MOVE vers le rangement, puis préparer la sortie pour une expédition liée.',
  },
  manufacturing: {
    prerequisites:
      'Articles, calendriers, postes, gammes et nomenclatures; runtime APS configuré pour l’ordonnancement.',
    rules: [
      'Une nomenclature décrit les composants; une gamme décrit les opérations; un poste représente une ressource de fabrication.',
      'L’ordre de fabrication possède son propre cycle de vie et référence ces données.',
      'Les articles WMS peuvent être créés depuis les formulaires de fabrication lorsque les permissions le permettent.',
      'Le résultat APS est une proposition de planification à examiner, pas un enregistrement fictif de production ou de stock.',
      'Atelier et stock réel exige Fabrication et WMS activés, manufacturing.read et wms.read. Déclarer demande aussi manufacturing.manage et wms.manage. Sur un OF en cours avec définition figée, saisissez les quantités bonnes/rebutées et chaque consommation réelle. Zéro explicite autorisé, sans lot ni mouvement; aucune consommation calculée automatiquement depuis la nomenclature.',
      'Un composant peut être réparti en plusieurs lignes lot/emplacement, jusqu’à 200 lignes. Tous les emplacements appartiennent au site de l’OF. Chaque article suivi exige son lot pour une quantité positive; un autre lot ne couvre jamais un manque. Le stock total, les soldes par lot et la déclaration sont enregistrés ensemble ou pas du tout.',
      'Les bons produits entrent dans un seul lot par déclaration, choisi explicitement si l’article le suit. Plusieurs lots produits exigent plusieurs déclarations. Le rebut ne crée aucun stock et une déclaration uniquement rebutée ne porte pas de lot produit. Les quantités bonnes/rebutées restent entières dans ce parcours.',
      'Déclarations et preuves WMS montre matières consommées → produit fini avec quantités, unités, emplacements et copies figées des lots/dates. Le lien concerne la déclaration, pas une allocation de matière par pièce. Les consommations antérieures ne sont pas rattachées implicitement. Les anciens dossiers restent signalés sans capture, jamais enrichis depuis le stock courant.',
      'Après réponse incertaine, reprenez la même déclaration conservée, avec même clé et mêmes lots. Un refus intermédiaire de reprise ne l’efface pas. Depuis le journal du lot, le lien vers l’OF est conditionné à vos droits Fabrication. Le MRP conserve les preuves dans son snapshot sans compter la production une seconde fois.',
      'Une erreur de déclaration v2 se corrige intégralement sur un OF en cours : examiner les effets, vérifier le stock physique et confirmer un motif. La contrepassation retire les produits finis disponibles à la source et restitue les matières aux mêmes lots/emplacements. Original, contrepassation, auteur et motif restent audités; le journal contient de nouveaux ajustements liés, jamais des mouvements supprimés. Saisir la déclaration correcte est une action séparée.',
      'Les compteurs bons/rebuts, la clôture de l’OF et les impacts matières excluent les déclarations contrepassées. Un nouveau MRP capture la contrepassation; les anciens calculs et leur preuve ne sont pas modifiés. Même après contrepassation complète, l’historique d’exécution continue de bloquer l’annulation de l’OF et la replanification APS globale sans temps réels.',
    ],
    limits: [
      'La disponibilité de la planification dépend du moteur APS. Une indisponibilité ne signifie pas que les données de fabrication sont perdues.',
      'WMS → Lots → Traçabilité du lot parcourt les liens atelier vérifiés par niveaux, en amont ou en aval, dans la chronologie des mouvements. Fabrication et WMS avec leurs droits de lecture sont requis pour voir ces liens. Versions anciennes ou preuves incohérentes arrêtent leur branche; contrepassations exclues. Les quantités d’une déclaration ne s’additionnent pas entre ses liens et ne sont jamais réparties par pièce. Pas de rappel réglementaire, réservation ni FEFO. La quarantaine ne se propage pas aux descendants. Correction complète v2 seulement, jamais partielle ni sur OF terminé; stock disponible au lot/bin d’origine requis. La reprise durable n’est pas un mode hors ligne complet.',
    ],
    example:
      'Préparez calendrier et poste, composez gamme et nomenclature, créez l’ordre puis examinez son placement dans l’échéancier.',
  },
  yard: {
    prerequisites:
      'Cour activée, droits yard.read/manage; sites et lieux gérés par le socle avec core.locations.read/manage. Transporteurs, remorques et chauffeurs se créent dans Cour → Données ou depuis les sélecteurs, sans Transport ni Flotte.',
    rules: [
      'L’occupation est déduite des visites actives. Deux visites ne peuvent pas occuper le même emplacement.',
      'L’affectation ou le déplacement crée un mouvement de cour dans la même transaction.',
      'Les coordonnées du plan sont uniquement visuelles. Déplacer un emplacement sur le plan ne déplace pas sa remorque.',
      'Relier un chargement, une réception ou une préparation apporte du contexte; cela ne change ni leur stock, ni leur coût, ni leur statut.',
      'Une visite liée à un rendez-vous utilise les liens du rendez-vous. Un passage terminé est en lecture seule.',
    ],
    limits: [
      'Le plan ne garantit pas la capacité future d’un quai. Les réservations de capacité et replanifications avancées sont distinctes.',
    ],
    example:
      'Liez une préparation à un rendez-vous, enregistrez l’arrivée, affectez un emplacement libre et enregistrez le départ.',
  },
  fleet: {
    prerequisites:
      'Flotte activée avec fleet.read/manage. Créer véhicules, remorques, chauffeurs et transporteurs dans Données ou Registre et plans; Transport n’est pas nécessaire.',
    rules: [
      'La maintenance utilise le même parc partagé que Transport, sans le dupliquer et sans exiger son activation. Modifier une fiche depuis Flotte modifie la même identité dans les autres applications; aucune disponibilité ne se change depuis Données.',
      'Ouvrir un ordre de maintenance peut placer l’actif en maintenance. Le clôturer ne libère l’actif que si aucun autre ordre ouvert ne le retient.',
      'Un actif retiré n’est jamais réactivé par la clôture d’une maintenance.',
      'La conformité est calculée à partir des documents et échéances, pas enregistrée comme une vérité indépendante.',
      'Les modifications du poste utilisent la version du dossier; l’échéancier affiche des dates limites, pas une réservation d’atelier.',
    ],
    limits: [
      'Le contexte transport exige aussi Transport et ses droits de planification.',
      'Les interventions Services ne remplacent pas les ordres de maintenance Flotte.',
    ],
    example:
      'Consultez une échéance, ouvrez une maintenance sur le bon actif, commencez le travail puis clôturez et contrôlez sa disponibilité.',
  },
  billing: {
    prerequisites:
      'Facturation activée, devises, taxes, comptes et droits propres au workflow. Clients et transporteurs se créent dans Données ou les sélecteurs, sans Transport. Les relevés issus du transport exigent des opérations transport; les autres sources gardent leurs parcours dédiés.',
    rules: [
      'Grand livre et rapports : choisissez explicitement une devise de transaction CAD/USD/EUR/MXN/GBP. Les nouvelles écritures client/transporteur/avoir/paiement la capturent depuis leur source; aucune conversion. Les agrégats restent exacts au centime. Les bornes de rapport sont des dates civiles UTC, fin de journée incluse. Les données et la couverture sont lues dans le même instantané.',
      'Historique : une ancienne écriture sans devise reste NULL, jamais rattachée à la devise par défaut du tenant. Les anciens actifs et périodes restent en lecture seule; leurs journaux existants peuvent recevoir une qualification distincte et groupée sur preuve. Les nouvelles dotations exigent une source avec devise et plan figés. Les écritures historiques NULL non qualifiées sont consultables dans le journal Sans devise et exclues des balances, résultats, bilans et flux. Seule une nouvelle contrepassation de paiement historique peut conserver une devise originale inconnue. Un nouvel avoir exige une facture comptabilisée dans la même devise connue ou qualifiée par son rapprochement source. Un rapprochement bancaire refuse une écriture non qualifiée.',
      'Reprise du journal historique : écritures manuelles sans devise, paiements dont le journal correspond exactement aux affectations, factures cohérentes et dotations enregistrées rapprochées par actif sont qualifiables sur justificatif. Les factures transporteur ajustées disposent d’un rapprochement spécialisé avec acceptation tracée et payable déjà comptabilisé. Les plans futurs des anciens actifs, journaux absents et sources incohérentes restent bloqués. La devise originale NULL, les lignes, comptes, dates et montants restent inchangés. Une annotation distincte, versionnée et révocable fournit la devise effective; aucun arrondi ni change.',
      'Paiements historiques : le dossier rapproche la devise source, le tiers, les affectations exactes et les lignes originales. Une annulation existante doit neutraliser les mêmes comptes; la décision couvre original et contrepassation ensemble. Une future annulation inverse les comptes réellement postés, même si le mode a changé, et transmet la qualification dans la même transaction. Les comptes d’origine doivent rester actifs. Retrait motivé sur preuve : les deux écritures redeviennent exclues ensemble. Retirez d’abord tout rapprochement bancaire. Un paiement incohérent reste bloqué; aucun solde de facture ne change à la qualification. Droits billing.ledger.read, billing.payments.read et billing.ledger.qualify; pièces et reprises respectent aussi ces droits.',
      'Paiements partiellement affectés : le total déclaré est distinct du total affecté, seul montant posté par le workflow actuel. La reprise accepte un journal égal exactement aux affectations positives, sans dépasser le déclaré. Le reste est affiché et capturé dans la revue; il reste non comptabilisé, ni crédit client ni avance fournisseur. Aucun journal complémentaire, affectation, remboursement ou preuve bancaire n’est créé. Le rapprochement bancaire exige toujours une affectation complète et reste donc bloqué. Un journal portant tout le déclaré malgré des affectations partielles demande une reprise spécialisée. Sans affectation ou sans journal, aucune qualification. Une annulation ne contre-passe que la portion effectivement postée.',
      'Facture transporteur ajustée : après ACCEPT_INVOICED, le total du document est le payable, tandis que les lignes attendues restent historiques. La reprise exige une décision d’acceptation unique et cohérente dans l’audit du tenant, un acteur du tenant, les références et dates de rapprochement, les montants reçus et les écarts exacts de chaque ligne. Somme reçue, total reçu et payable doivent coïncider; écarts signés et absolus sont vérifiés séparément. Le journal doit correspondre au payable moins les taxes déjà figées, avec les comptes et taxes originaux. Exemple : 100 attendus, 120 reçus/acceptés et 15 de taxes figées donnent 105 hors taxes au journal; le payable diffère de 5 de l’attendu taxes incluses, mais l’écart de lignes reste 20. Aucune ventilation fiscale ou taux n’est déduit des lignes reçues. Le motif et la preuve humaine restent obligatoires. Une acceptation manquante, multiple, KEEP_EXPECTED ou incohérente ne permet pas de contourner un écart. Aucun journal absent, montant, solde ou règlement n’est créé ou corrigé; aucun recalcul des coûts Transport. Finance seul suffit avec le droit de lecture des factures et celui de qualification du journal.',
      'Factures historiques : rapprochement des lignes nettes, taxes figées, total et comptes originaux. Facture client et avoirs émis sans devise se qualifient ensemble; les avoirs à devise connue restent inchangés et interdisent le retrait isolé de l’original. Un nouvel avoir après reprise capture sa devise connue. Aucun journal absent n’est créé par la qualification et aucun taux actuel n’est recalculé. Droits billing.customer-invoices.read ou billing.invoices.read selon la source, plus billing.ledger.read et billing.ledger.qualify pour décider. Finance seul suffit; aucune activation Transport ou Services implicite. Les avoirs fournisseur documentaires restent hors GL. Au-delà de 500 lignes de facture ou 200 avoirs, une reprise spécialisée est requise.',
      'Preuves de qualification : PDF/PNG/JPEG de 10 Mo maximum, description et empreinte SHA-256, sans remplacement ni suppression. Le droit billing.ledger.qualify est distinct de la saisie manuelle. Un humain actif prépare une revue, vérifie l’effet puis confirme. Preuve et écriture doivent appartenir au même tenant et dossier; lignes déséquilibrées, fractions de cent, source changée ou version périmée bloquent la confirmation. Annotation, révision et audit sont atomiques.',
      'Retrait de qualification : motif et preuve obligatoires, puis confirmation. Aucune contrepassation ni effacement : les rapports excluent de nouveau cette écriture. Une autre devise nécessite un retrait préalable puis une nouvelle revue. Les 30 dernières décisions sont visibles et toutes restent conservées. Après réponse incertaine, conserver UUID/acteur/corps et reprendre exactement la demande; après dépôt incertain, vérifier le registre puis resélectionner le même fichier si nécessaire.',
      'Liens de la reprise historique : journal, balance, résultats, bilan, flux et budgets utilisent la même devise effective et distinguent les écritures ainsi qualifiées dans la couverture. La qualification actuelle affecte aussi les anciennes périodes; ce n’est pas une restitution de la connaissance historique. Les montants métier des paiements et actifs ne sont jamais corrigés par cette annotation. Pas de clôture, d’attestation fiscale ou de preuve automatique de complétude.',
      'Immobilisations : chaque brouillon capture une devise de transaction explicite, un coût et résiduel exacts, sa référence d’acquisition, sa date civile, le premier mois et la durée de 1 à 1200 mois. Le résiduel ne dépasse jamais le coût. Compte de charge EXPENSE et compte de cumul ASSET distincts et actifs dans cette entreprise. Aucun module opérationnel ni accès complet au grand livre requis pour tenir ce registre.',
      'Plan d’amortissement : mensualités complètes sans prorata journalier. Le cumul linéaire est arrondi au centime, moitié vers le haut; les dotations sont les différences entre cumuls. Par exemple 100 sur trois mois donne 33,33 puis 33,34 puis 33,33. L’activation demande une revue et une confirmation; elle fige plan, comptes, dates et devise. Changer le profil comptable ou les réglages du tenant ne recalcule jamais ce plan.',
      'Comptabilisation des actifs : un humain actif avec billing.assets.read/manage/post confirme le prochain mois seulement, une fois sa fin civile UTC atteinte. Dotation, cumul, journal équilibré, version et audit sont atomiques. Une dotation nulle est enregistrée mais ne crée pas de GL fictif. Le lien journal demande billing.ledger.read; les rapports et budgets incluent cette écriture uniquement dans sa devise. Reprise exacte UUID/acteur/corps après réponse incertaine, jamais un nouveau clic avec une nouvelle clé.',
      'Retrait du suivi : motif, version et confirmation arrêtent les dotations futures, sans effacer le dossier, ses montants ni son historique. Ce retrait ne comptabilise aucune vente, sortie, plus-value ou moins-value. Les anciens actifs ne peuvent être requalifiés par une simple édition : seule la reprise de leurs dotations déjà comptabilisées est disponible; le plan futur reste un chantier distinct. Acquisition, méthodes fiscales, conversion, réévaluation et contrepassations ne sont pas automatisées.',
      'Dotations historiques : depuis un ancien actif, Reprendre les dotations historiques ouvre le groupe ancré sur sa première écriture. Jusqu’à 1200 périodes réelles sont rapprochées exactement avec le cumul enregistré, sous le coût moins résiduel. Chaque période exige un journal unique, daté au premier jour UTC du même mois, avec débit Charge et crédit Actif distincts égaux au montant; les comptes sont ceux réellement postés, pas les paramètres actuels. Les mois absents sont signalés, jamais complétés ni recalculés. Devise explicitement attestée par une preuve couvrant le groupe; aucune valeur par défaut. Qualification et retrait couvrent toutes les dotations ensemble. Immobilisation, périodes, cumul et journaux originaux restent inchangés; aucun plan futur activé. Historiques incomplets, mélangés à des devises connues, incohérents ou hors limites demandent une reprise spécialisée. Droits billing.assets.read et billing.ledger.read sur dossier, preuves et reprises, plus billing.ledger.qualify pour décider; Finance seul suffit.',
      'Profil comptable : chaque entreprise choisit Pulsar natif comme cible ou un logiciel externe nommé, avec devise fonctionnelle cible, motif, droit billing.accounting.configure et confirmation. Révisions conservées. Ce choix n’active ni comptabilité officielle, ni change, ni connecteur : il ne réécrit aucune source et n’est jamais un défaut de posting.',
      'Budgets : devise de transaction explicite et dates civiles UTC inclusives figées, période au plus 366 jours commençant dans l’exercice indiqué. Comptes actifs locaux distincts, montants exacts à deux décimales. Les réglages fiscaux futurs n’altèrent pas ces bornes. Modifier produit une révision; décocher actif archive sans supprimer. Les vingt dernières révisions sont consultables. Les anciens budgets NULL restent en lecture seule : créer un nouveau budget qualifié, sans backfill.',
      'Écarts budgétaires : budget moins mouvement net de la période au sens naturel du compte, pas un solde de clôture. Devise et période capturées; autres devises et NULL exclus et signalés sur les seuls comptes du budget. Aucune conversion ni somme trompeuse entre actifs, charges et produits; un écart positif n’est pas nécessairement favorable. En cas de réponse incertaine, garder la demande et reprendre le même UUID, acteur et corps; une autre modification concurrente exige un rechargement.',
      'Écriture manuelle : billing.ledger.read et manage, réglage ledgerManualEntries actif, date civile obligatoire, devise explicite, 2 à 200 lignes, débit OU crédit positif, maximum 9 999 999 999,99 par ligne et équilibre exact. Confirmation humaine; journal et audit atomiques. La demande conservée est propre à l’entreprise et à l’utilisateur. Après réponse perdue, vérifier la clé ou reprendre exactement la même demande, jamais en créer une seconde. Une autre personne ne peut pas rejouer cette clé.',
      'Portée des rapports : arithmétique équilibrée ne signifie pas complétude. Les auto-postings de factures restent best-effort; vérifier les pièces absentes. Les âgés clients/transporteurs lisent les soldes courants, diminués des encaissements et, côté client, des avoirs. Ils les classent par date d’approbation/création, non par échéance; la date choisie ne restitue pas une balance historique. Les factures fournisseur générales ne sont pas l’AP transporteur. Ni devise fonctionnelle, ni taux/écarts de change, ni clôture de période ni certification des états dans ce lot.',
      'Factures fournisseur générales : Finance → Factures fournisseur utilise un registre distinct des factures transporteur et des factures clients. Finance seul suffit. Le fournisseur partagé se crée depuis le sélecteur ou Données; Transport, Catalogue, Achats et WMS ne sont pas requis. Droits distincts : billing.supplier-invoices.read, manage et qualify. Le commis prépare, le qualificateur peut figer sans modifier les lignes; une même personne peut détenir les deux droits.',
      'Dossiers fournisseur : Finance → Dossiers fournisseur réunit les factures générales, avoirs reçus et pièces de chaque fournisseur partagé. Recherche nom/code, actifs ou désactivés, puis filtre type/statut/devise/date civile et recherche de référence; les pièces ajoutent recherche fichier/description. Les lignes sont paginées en base. Le fournisseur renommé ou sorti du rôle garde son historique si des factures existent; le nom capturé sur chaque document reste inchangé. Un relevé transporteur ou une commande Achats ne figure pas dans ce registre documentaire.',
      'Synthèse fournisseur : tout l’historique QUALIFIED, indépendamment des filtres de liste. Les montants et leur affichage restent exacts au centime même pour de grands cumuls, séparés par devise sans change. Brouillons et annulés sont comptés mais exclus du reste documentaire. Factures moins avoirs ne signifie jamais solde à payer : aucun règlement, grand livre, échéancier ou lettrage pris en compte. Un écart incohérent est signalé, jamais remplacé par un zéro rassurant; aucun document qualifié signifie aucune devise inventée.',
      'Pièces du dossier fournisseur : métadonnées et original sélectionné se consultent avec la lecture des factures fournisseur; Télécharger passe par les contrôles protégés de chaque document. Aucun lien public de stockage. Ouvrir retrouve la facture et son avoir exact dans les panneaux de travail, où ajout de fichiers et qualification gardent leurs droits propres. Aucun snapshot Achats/WMS ne transite dans cette liste. La synthèse affiche son instant de lecture; Actualiser relit listes et totaux. Les filtres portent sur la date civile du document parent, non sur la date de dépôt du fichier.',
      'Saisie fournisseur : numéro externe original et numéro interne FF distincts, date et échéance civiles, devise CAD/USD/EUR/MXN/GBP, 1 à 100 lignes avec quantité/unité et montant net déclaré après remise, jusqu’à 20 composantes de taxe nommées. Les montants sont additionnés exactement au centime; ni taux, ni déductibilité, ni fiscalité ne sont déduits. Le numéro externe normalisé reste unique par fournisseur même après annulation. Aucun change ou montant négatif dans ce registre : les avoirs reçus disposent maintenant de leur section dédiée dans la facture qualifiée.',
      'Lien Achats : chaque ligne de facture peut référencer explicitement une ligne de commande confirmée ou clôturée du même fournisseur, de même unité et devise. Quantité et prix d’achat sont capturés, pas appliqués à la facture. La lecture Achats et son activation sont revérifiées. Sans cet accès, la facture reste visible mais les références et montants d’achat sont masqués et le dossier lié ne peut plus être modifié/qualifié. Pas de rapprochement automatique de réception ni de contrôle des quantités déjà facturées entre plusieurs factures.',
      'Justificatifs fournisseur : PDF, PNG ou JPEG de 10 Mo maximum, 30 pièces maximum, uniquement sur brouillon. Le fichier est conservé sans remplacement ni suppression, avec son auteur et son empreinte. Il faut choisir explicitement l’original au moment de qualifier. La qualification humaine exige un compte rendu, une version à jour et le droit dédié; elle fige le dossier, sans écriture comptable, paiement, email ou stock. Une facture qualifiée ne revient pas en brouillon; un avoir fournisseur reçu compense des montants sans rouvrir cette facture.',
      'Avoirs fournisseur reçus : ouvrir une facture qualifiée, puis sa section Avoirs fournisseur. Une source immuable, devise et fournisseur hérités. Montants positifs déclarés par ligne source et taxe source (position conservée même si les libellés se répètent). Le cumul qualifié est plafonné séparément par chaque composante, avec cents exacts et verrou à confirmation; un brouillon ne réserve rien. Un avoir peut porter sur les taxes seules, jamais sur un montant total nul. Aucune quantité physique ou taxe proportionnelle calculée. Le reste créditable n’est pas un solde à payer.',
      'Qualification d’avoir : droits billing.supplier-credits.manage et qualify distincts, lecture par billing.supplier-invoices.read. Enregistrer les edits, joindre et choisir l’original propre à cet avoir, rédiger le compte rendu puis confirmer. Seul un brouillon est annulable; un avoir qualifié reste figé. Numéro externe unique par fournisseur, conservé après annulation. Aucun changement de facture, paiement, grand livre ou stock. Dates civiles et fuseau des opérations distincts.',
      'Retour WMS et avoir : lien facultatif au dernier suivi versionné d’un retour POSTED du même fournisseur. Reçus/acceptés/refusés sont du contexte, pas une allocation aux lignes ni un crédit automatique. Une nouvelle révision bloque la qualification du brouillon, pas la lecture historique d’un avoir qualifié. Sans WMS et son droit read, les IDs et copies de retour sont masqués; impossible de modifier, retirer le lien, qualifier ou reprendre la mutation liée. Finance autonome reste possible sans ce lien. Pour la reprise, rouvrir la facture source puis Vérifier la demande d’avoir; sinon reprendre le même corps et la même clé.',
      'Reprise fournisseur : chaque écriture conserve une clé liée au tenant, à son auteur et au contenu exact. Après réponse perdue, Vérifier la demande retrouve le résultat sans renvoyer; Reprendre la même demande utilise la même clé et le même corps. Un refus lors de cette reprise ne fait pas perdre la demande. Pour un justificatif, resélectionnez exactement le même fichier si le serveur ne confirme pas son enregistrement. L’historique affiche les 30 dernières opérations; les dates de saisie affichent le fuseau utilisateur.',
      'Échéancier fournisseur opérationnel : Finance → Échéancier fournisseur, ou depuis la facture qualifiée et le dossier fournisseur. Finance seul suffit. La lecture utilise billing.supplier-invoices.read; confirmer, réviser ou retirer demande en plus billing.supplier-schedules.manage et un utilisateur interne actif. Les rôles existants ne reçoivent pas automatiquement ce nouveau droit. Aucun nouvel outil agent ne peut confirmer un planning.',
      'Préparer une révision : ajouter jusqu’à 60 dates civiles réelles, distinctes et croissantes, pas avant la date de facture. Chaque montant est positif à deux décimales maximum; la somme doit égaler exactement la facture moins les avoirs qualifiés, sans arrondi ou conversion. Reprendre l’échéance de la facture est explicite, pas un calcul automatique des conditions de paiement. Le motif explique la convention. Examiner les effets est une lecture; confirmer exige la revue à jour et une confirmation humaine. Toute édition invalide la revue. Une confirmation concurrente impose de recharger.',
      'Historique d’échéancier : chaque confirmation ou retrait ajoute une révision avec auteur, instant, motif, dates, devise, montant et avoirs capturés. Aucun remplacement de l’historique ni modification de la facture originale. Un nouvel avoir qualifié rend la révision confirmée À revoir et l’exclut de la prévision. Il faut répartir et confirmer de nouveau; rien ne raccourcit automatiquement la dernière échéance. Si les avoirs couvrent toute la facture, confirmer explicitement une répartition vide : couvert par avoirs ne signifie pas payé. Retirer exclut le planning sans annuler la facture; une confirmation ultérieure peut le rétablir.',
      'Lire la prévision : montants exacts par devise, tous les résultats filtrés, pas seulement la page visible. Les dates se classent avant la référence, à la référence, dans 1–7 jours, 8–30 jours et au-delà. La référence est une date civile de classement du planning courant, pas une reconstitution historique; les heures d’action affichent le fuseau utilisateur. À planifier, retiré, incohérent et à revoir restent hors prévision confirmée. Une date dépassée ne prouve pas un impayé. Aucun règlement, trésorerie bancaire ni change n’est pris en compte.',
      'Reprise d’échéancier : la demande exacte est conservée localement avant envoi, par tenant/utilisateur/facture. Après réponse perdue, Vérifier la demande retrouve la révision par sa clé; Reprendre la même confirmation garde clé et corps, même après un refus intermédiaire. Ne pas recréer un planning pour compenser. Si aucun enregistrement n’est trouvé, Vérifier l’absence puis refaire la revue relit les données avant une nouvelle confirmation. Une réponse 404 constate seulement l’absence au moment de la lecture; le contrôle de version empêche deux révisions concurrentes depuis la même base. Stockage local indisponible ou corrompu : confirmation bloquée, pas de réessai aveugle.',
      'Sur un relevé client brouillon, Coordonnées du document permet de sélectionner les versions du carnet de son client facturable, sans module Clients ni Transport. L’approbation exige la version revue et recontrôle validité, identité et fraîcheur sous verrou. La copie est figée dans la même transaction que le statut APPROVED; les changements ultérieurs du carnet ne la réécrivent pas. Un document historique sans copie reste identifié comme tel.',
      'Le contact sélectionné est descriptif : il ne remplace pas automatiquement le destinataire de courriel, les règles fiscales, les droits portail ou un site opérationnel. Pour un PDF de facture client ou d’avoir, reprendre la copie de la facture est un choix explicite décrit ci-dessous; les autres PDF ne sont pas modifiés par la sélection. Les Services et la Facturation ont leurs identités distinctes : une copie de devis n’est pas automatiquement transférée à une facture. Après une réponse incertaine de sélection, utilisez Vérifier le document enregistré avant de refaire un choix.',
      'Les gabarits actuels acceptent plusieurs lignes de taxes, sans plafond métier de trois. Chaque taux s’applique à la même base nette. Les règles de juridiction, dates d’effet et taxes composées ne sont pas déterminées automatiquement.',
      'Dans le carnet du client, Documents liés distingue les brouillons à revoir et les copies approuvées conservées, y compris payées. Les commandes Transport exigent leurs propres droits et module. La vue ne lit pas les PDF, les avoirs ni les destinataires de remise; elle ne prouve pas une absence d’usage hors des captures accessibles et ne valide pas toute la facture.',
      'PDF d’avoir : dans une facture client, ouvrir l’avoir validé puis Document et envoi client. Confirmer nom légal, adresse de l’émetteur, inscriptions fiscales applicables (obligatoires si taxes) et identité du client. Les réglages Facturation préremplissent l’émetteur; ce sont des données actuelles à vérifier, pas des coordonnées historiques reconstituées. Figer et générer conserve définitivement les identités, dates, lignes, taxes et montants. Le droit billing.credit-notes.approve est requis. Modifier le Catalogue ou les réglages ne modifie plus ce PDF.',
      'PDF de facture client : après approbation, ouvrir Document et envoi de la facture. Les réglages Factures clients proposent l’émetteur, distinct de celui des avoirs. Reprendre la copie de la facture retient son identité/adresse figées; une autre saisie exige un motif si cette copie existe. Confirmer puis générer conserve un seul PDF. Les lignes, taxes et total doivent se rapprocher exactement; une incohérence historique bloque la publication, sans inventer de taxe. Le PDF indique séparément publication et approbation et ne prétend pas être une preuve de paiement.',
      'Remise de facture : télécharger le PDF, vérifier le destinataire et confirmer simulation ou SMTP avec le droit billing.customer-invoices.send (lecture requise). La publication demande lecture et gestion des factures clients. L’approbation ne déclenche plus aucun envoi automatique client, même si une ancienne option est activée. Le raccourci historique Envoyer sans document est fermé. Simulation et mise en file ne changent pas le statut comptable; la preuve disponible est le journal de remise, pas APPROVED/SENT. Encaissements et avoirs restent indépendants.',
      'Reprise et portail : après réponse incertaine, actualiser avant de répéter. La génération repart du même instantané; un PDF disponible n’est jamais remplacé. Une simulation puis un envoi SMTP confirmé sont possibles, jamais deux envois du même canal. Ancien historique d’envoi sans canal qualifié ou ancienne date sentAt : renvoi bloqué pour contrôle opérateur. Les anciens messages en attente ne repartent pas automatiquement. Le portail du client concerné télécharge le même PDF canonique vérifié si la publication a commencé; aucune substitution par un ancien fichier si le PDF est manquant ou corrompu. Sans publication, son accès historique aux anciens fichiers reste inchangé.',
      'Source du client sur l’avoir : Reprendre la copie de la facture utilise uniquement son nom et son adresse de facturation figés à l’approbation. Une ancienne version reste historique même si le carnet a changé ou que l’adresse a été désactivée. Le serveur recontrôle l’empreinte affichée. Une saisie manuelle reste possible avec motif quand une copie existe; sans copie, elle est confirmée à la publication, sans inventer l’historique. La provenance reste visible. Notes, livraison, téléphone et courriel ne sont pas imprimés; le PDF signale la date de la copie reprise.',
      'Après publication depuis la copie facture, Reprendre le courriel du contact figé propose son ancienne adresse email séparément. Vérifiez qu’elle est encore appropriée ou saisissez un autre destinataire. Une modification retire la confirmation d’envoi. Le choix postal n’autorise aucun envoi et ne donne aucun accès au portail. Facturation fonctionne seule : ni Clients, ni Transport, ni Services ne sont requis pour ce parcours.',
      'Envoi d’avoir : télécharger et vérifier le PDF, saisir le courriel du destinataire, puis confirmer avec billing.credit-notes.send et le droit de lecture des factures clients. Un document exact est obligatoire; son absence ou une empreinte différente bloque l’envoi. La simulation locale ne transmet rien. SMTP signifie une remise réelle au serveur, pas une preuve de réception. Une simulation ne devient jamais un envoi réel en arrière-plan : il faut une nouvelle confirmation après configuration de la connexion.',
      'Reprise du PDF : après coupure, Actualiser le document et l’envoi avant toute action. Des coordonnées déjà figées sont conservées même si le stockage échoue; reprendre la génération utilise le même instantané. Un PDF déjà publié ne se régénère pas. Un seul envoi réel et une simulation sont possibles par avoir; un rejeu relit l’historique sans renvoyer. Un échec, une remise en cours ou un résultat incertain nécessitent une vérification opérateur, jamais une relance automatique. La date du document et la date de validation comptable sont distinctes, en UTC.',
      'Avoir client : ouvrir une facture approuvée, envoyée ou payée, puis Avoirs et solde client. Sélectionner les quantités à créditer et un motif, calculer le brouillon, vérifier les montants puis confirmer. La création demande billing.customer-invoices.read/manage; valider exige billing.customer-invoices.read + billing.credit-notes.approve. Un brouillon peut être annulé; un avoir validé est définitif. Ce droit distinct ne force pas une séparation entre auteur et approbateur.',
      'Les prix et taxes viennent de l’instantané de la facture : aucune taxe actuelle n’est recalculée. Les arrondis cumulés répartissent les centimes sans dépasser le montant original. Les lignes sans quantité ou avec une précision supérieure à quatre décimales se créditent en fraction de ligne (1 = toute la ligne). Un brouillon périmé après validation d’un autre avoir doit être annulé puis recréé.',
      'Valider l’avoir comptabilise la correction dans la même transaction que le solde. Si l’écriture originale manque, la confirmation la crée aussi depuis la facture figée. Les comptes de l’écriture originale sont réutilisés; un compte absent/inactif ou une écriture non standard bloque sans valider l’avoir. La facture d’origine ne change ni de montant ni de taxes.',
      'Restant dû = facture moins encaissements moins avoirs, au minimum zéro. Un avoir n’est pas un paiement : le statut PAID reste réservé à l’encaissement du montant original. Une facture couverte par avoir peut donc rester APPROVED/SENT avec zéro dû. Les nouveaux paiements, le portail et les créances âgées utilisent le solde net. Un excédent devient un crédit client à traiter; aucun argent n’est remboursé.',
      'L’avoir lié à une pièce Services autorise un retour physique séparé, vers l’emplacement d’origine, dans la limite des quantités créditées non encore retournées. Un avoir de geste commercial peut rester sans retour. Après réponse perdue, reprendre le brouillon conservé; relire l’état avant de répéter une validation, qui est idempotente.',
      'Une facture transporteur est rapprochée contre le coût figé du chargement, jamais contre un recalcul courant.',
      'L’audit de fret calcule les écarts de manière déterministe. Un agent peut proposer un traitement, pas inventer un écart.',
      'L’approbation, l’envoi, le paiement et le rapprochement sont des opérations distinctes.',
      'Un paiement rapproché ne peut pas être simplement annulé; il faut respecter le parcours de correction.',
      'Le rapprochement bancaire vérifie notamment montant, sens et devise. Un lien de dossier ne crée pas à lui seul une écriture.',
    ],
    limits: [
      'Le passage d’une frontière ne suffit pas à choisir une taxe. Les dossiers douaniers, motifs de détaxation/exonération et justificatifs du mouvement continu restent un chantier à valider avec l’expert fiscal; l’adresse du payeur seule n’est pas une règle de calcul transport.',
      'PDF et envoi explicite disponibles, mais pas de remboursement bancaire, transfert entre factures, note de débit compensatrice, nouvelle adresse après premier envoi ni relance libre. Les mentions et inscriptions doivent être vérifiées selon la juridiction; aucune certification fiscale ni livraison SMTP garantie. Le PDF utilise une typographie latine occidentale. Les 100 derniers avoirs sont affichés; les soldes incluent tout l’historique.',
      'Le registre fournisseur général accepte des liens documentaires vers les commandes Achats, mais pas encore leur comptabilisation, paiement ni rapprochement commande/réception/facture. Il n’est pas inclus dans les dettes comptables du grand livre. Les commandes matières Fabrication ont leur propre contrat et ne sont pas liées automatiquement.',
      'Les rapprochements partiels, groupés et traitements de change demandent des fonctions dédiées.',
    ],
    example:
      'Ouvrez l’écart d’une facture, examinez le coût attendu, résolvez le litige puis suivez le paiement dans son dossier.',
  },
  crm: {
    prerequisites:
      'Pipeline et étapes, entreprises et contacts; connecteurs configurés pour communiquer.',
    rules: [
      'Depuis une opportunité, Communications propose les contacts de sa société. SMS/courriel humains, modèles opérationnels modifiables et historique propre à l’opportunité. Autorisation par coordonnée et canal, décision avec preuve; ce n’est pas un consentement marketing et cela ne lance aucune séquence. Les modèles du panneau ne remplacent pas les gabarits HTML du module Courriel.',
      'Autonomie : les sociétés possèdent leur carnet Adresses et contacts, accessible dans leur fiche et depuis une commande. Seuls CRM et ses droits sont requis. Customer, partenaire Services et société CRM restent des identités distinctes; aucun rapprochement par nom ou courriel.',
      'Le carnet garde chaque révision et son motif. Les contacts de prospection ne sont pas copiés automatiquement. Fonction et validité ne créent ni accès portail, ni destinataire de séquence, ni consentement marketing.',
      'Documents liés, dans le carnet de la société, retrouve uniquement ses commandes CRM capturées. Le lien Customer de la société ne donne pas d’accès aux commandes Transport ou aux factures dans cette vue. Brouillon à revoir et copie engagée conservée sont distingués; la vérification de cette entrée ne valide pas toute la commande.',
      'Commande brouillon : choisir explicitement adresse de facturation, adresse de livraison et contact dans Coordonnées. Une sélection partielle est possible. Les choix sont des copies de versions serveur, pas une référence toujours actualisée. Retirer les trois choix efface seulement la copie du brouillon.',
      'Confirmation : relire lignes, prix, devise et coordonnées. Une adresse modifiée, expirée, désactivée ou une société renommée/inactive bloque une copie non revue. La version de la commande inclut aussi les changements de lignes. Les coordonnées sont figées atomiquement avec CONFIRMED; le carnet actuel ne réécrit pas le passé.',
      'Après une sauvegarde ou confirmation incertaine, utiliser Vérifier le document enregistré ou Vérifier le statut enregistré. Ne pas répéter aveuglément : le serveur a pu avoir enregistré l’action. Les écritures du carnet disposent de leur propre clé de reprise.',
      'La devise ne change plus après confirmation; avec des lignes au brouillon, les retirer avant de la modifier. Aucune conversion monétaire implicite. Les lieux et preuves Transport, demandes MRP et factures restent validés dans leur module; les coordonnées privées CRM ne sont pas propagées automatiquement.',
      'Les étapes configurées structurent les opportunités et les déclenchements d’automatisation.',
      'Une automatisation doit être comprise avec son déclencheur, ses conditions et son canal de communication.',
      'Les coordonnées et accès au portail client ne sont pas nécessairement la même identité : une fiche contact n’est pas un compte utilisateur.',
      'Les actions réelles des agents restent soumises aux droits, plafonds et approbations configurés.',
    ],
    limits: [
      'Les commandes anciennes sans copie ne reçoivent aucun historique inventé. Pas encore de PDF commercial canonique, d’avenant après confirmation, de quatre identités donneur d’ordre/livré/facturé/payeur ni de fusion CRM/Client. Le statut Facturée du CRM n’est pas, seul, une preuve comptable de facture publiée.',
      'Les produits CRM et le nouveau Catalogue ne sont pas synchronisés automatiquement.',
      'Ne lancez pas des séquences sur de vrais destinataires pour tester sans vérifier le transport de courriel et les règles de consentement applicables.',
    ],
    example:
      'Qualifiez une opportunité dans une étape du pipeline, vérifiez son contact et préparez la prochaine relance.',
  },
  agents: {
    prerequisites: 'Runtime et fournisseur configurés pour le tenant, rôle et outils autorisés.',
    rules: [
      'L’icône Assistant IA, en haut de Pulsar, ouvre l’Espace IA sans module supplémentaire : historique privé, choix du worker et modèle configuré. Changer de worker ouvre une autre conversation. Plusieurs réponses peuvent avancer en parallèle; le badge compte celles de cet onglet.',
      'Fermer le panneau ne stoppe pas les réponses tant que Pulsar reste ouvert. Recharger ou fermer l’onglet ne transfère pas le chat au worker automatique : relire l’historique avant de renvoyer. Les tâches durables et leurs AgentRun restent distincts. Une réponse non validée n’est jamais une réussite.',
      'Le runner de production accepte quatre processus simultanés par défaut, capacité partagée avec les tâches automatiques. Login OAuth exclusif; changement de configuration après les sessions en cours. Les droits, plafonds et approbations restent identiques, même avec plusieurs workers.',
      'Connexion IA distingue le moteur Hermes, le fournisseur/modèle et la gouvernance Pulsar. En production, un runner dédié à l’entreprise est rattaché une fois par l’administrateur; fournisseur, clé ou OAuth et modèle se configurent ensuite ici. Le diagnostic distingue un service non rattaché ou injoignable. En développement local, il lit les versions locales. Aucun appel au modèle ni mise à jour automatique.',
      'Vérifier le runtime ouvre une session ACP sans prompt : cela ne valide ni la clé fournisseur, ni la facturation, ni la qualité métier. Enregistrez avant le contrôle ou le login. Changer de fournisseur ou d’URL retire l’ancienne clé; une nouvelle clé doit être fournie explicitement.',
      'Le parcours agent expose uniquement les outils MCP de Pulsar, pas le terminal, les fichiers ou le navigateur du serveur. Une demande de privilège système ACP est refusée; une proposition métier approuvée ne donne jamais accès au système.',
      'Un agent ne dispose que de l’intersection entre ses permissions, les modules activés et sa liste d’outils.',
      'Les mutations passent par la gouvernance des actions proposées. L’autonomie ne supprime pas les plafonds de montant et de débit.',
      'Les actions automatiquement approuvées restent enregistrées et auditables.',
      'Pause arrête le travail de façon réversible; la révocation est permanente.',
      'Un circuit de sécurité peut ramener l’agent en mode proposition. La promotion d’autonomie exige une confirmation humaine.',
      'Un runtime indisponible ne doit pas arrêter le cœur de Pulsar. Consultez le run et sa raison d’échec ou de saut.',
      'Le chat distingue une réponse confirmée, non validée et interrompue. Une fin de flux seule ne prouve pas la réussite. Le worker ne marque SUCCEEDED que si le moteur confirme le résultat; cela ne prouve pas que chaque action métier a réussi. Consultez les propositions et les dossiers sources.',
      'Un tour sans fin est arrêté après deux minutes. Un run FAILED ou KILLED ne repart pas automatiquement au prochain passage du worker : vérifiez les actions déjà engagées, puis utilisez Lancer maintenant si une reprise est nécessaire. Une tâche déjà résolue ne se rouvre pas sur une erreur tardive.',
      'Le compteur de tokens affiché, lorsqu’il est disponible, est cumulatif pour le processus IA courant. Ce n’est ni le coût du message, ni une facture, ni un budget tenant. Une valeur absente reste inconnue; la génération automatique des titres par un modèle est désactivée.',
    ],
    limits: [
      'La référence locale Hermes 0.16.0 n’est pas la dernière version officielle repérée. Mise à jour et changement de moteur exigent une qualification séparée, une isolation serveur et une recette sur missions réelles avec budget autorisé. Aucune qualité de réponse n’est garantie par un simple contrôle local.',
      'Après un redémarrage, Pulsar recharge le même historique de conversation. Si cet historique manque, la reprise échoue explicitement : aucune conversation vide ne remplace silencieusement le contexte et les consignes de l’agent. Une erreur ou un arrêt ne prouve jamais qu’une action métier a été annulée; vérifier le journal et les propositions avant de relancer.',
      'Un module nouvellement ajouté n’a pas automatiquement des outils AI. Services et SAV proposent maintenant des lectures et mutations gouvernées ciblées; Catalogue et Achats fournisseurs restent sans outil de mutation dédié.',
    ],
    example:
      'Donnez un rôle limité à un agent, observez sa proposition, vérifiez le dossier et approuvez seulement l’action attendue.',
  },
  analytics: {
    prerequisites: 'Applications sources actives et droits de lecture nécessaires.',
    rules: [
      'Les indicateurs et chaînes de flux sont calculés à la lecture depuis les données sources.',
      'Une chronologie aide à retracer événements, tâches et actions. Elle ne constitue pas une nouvelle autorité sur leur statut.',
      'Un ratio doit être lu avec sa période, son périmètre et son dénominateur; ouvrez la source pour comprendre une anomalie.',
    ],
    limits: [
      'Les nouveaux Services et Achats ne publient pas encore leurs événements dans la Control Tower.',
    ],
    example:
      'Repérez une alerte, ouvrez la chaîne de flux, puis le dossier responsable au lieu de corriger un chiffre agrégé.',
  },
  procurement: {
    prerequisites: 'Corridors et transporteurs Transport; droits procurement.read/manage.',
    rules: [
      'Ce module gère la mise en concurrence des transporteurs sur des corridors.',
      'Une invitation permet une soumission; l’évaluation et l’attribution sont des étapes distinctes.',
      'Le guide de routage exprime des préférences et ne prouve pas qu’un transport a été exécuté.',
    ],
    limits: [
      'Pour acheter des fournitures ou prestations, utilisez Achats fournisseurs. Les deux applications possèdent des tables et workflows distincts.',
    ],
    example:
      'Préparez un appel d’offres par corridor, invitez les transporteurs, comparez les offres puis attribuez.',
  },
  'customer-portal': {
    prerequisites: 'Un client, module activé et permissions de gestion des comptes portail.',
    rules: [
      'Un compte portail est distinct d’un compte interne. Son périmètre est celui du client autorisé.',
      'Une invitation permet au destinataire d’activer son accès; le personnel ne devrait pas transmettre un mot de passe partagé.',
      'Une demande de changement est une demande persistée, pas une modification automatique du transport.',
      'Le branding du portail s’applique au portail, pas à l’apparence personnelle du bureau.',
      'Les liens publics de suivi ne doivent exposer que le contexte public prévu, pas tous les arrêts ni l’historique de position d’une tournée.',
    ],
    limits: [
      'Les anciens liens à jeton peuvent subsister selon la configuration. Gérez leur révocation séparément des comptes nommés.',
    ],
    example:
      'Invitez un utilisateur du client, puis traitez sa demande de changement dans la file staff avant de modifier le dossier transport.',
  },
  documents: {
    prerequisites: 'Dossier source et droits de lecture ou gestion des fichiers.',
    rules: [
      'Les fichiers passent par le stockage configuré de Pulsar et sont rattachés à leur contexte métier.',
      'Ajouter une preuve ne vaut pas nécessairement validation du dossier : utilisez l’action métier prévue.',
      'Les règles d’accès continuent de s’appliquer au téléchargement. Ne partagez pas un document hors de son périmètre.',
    ],
    limits: [
      'Documents conserve les pièces; Documentation explique l’utilisation du logiciel. Ce sont deux applications différentes.',
    ],
    example:
      'Retrouvez une pièce par son dossier, consultez sa catégorie puis ouvrez le dossier source pour poursuivre le traitement.',
  },
  connect: {
    prerequisites:
      'Droits de gestion, système externe choisi et secrets configurés via les formulaires prévus.',
    rules: [
      'Telnyx : Connexions → SMS. Numéro E.164, Messaging Profile, clé API chiffrée, clé publique de signature, adresse HTTPS et plafond quotidien par entreprise. Activation réelle confirmée dans Pulsar, sans variable serveur. core.sms.read, send et manage séparent consultation, envoi et configuration; aucun module métier imposé. Les anciennes connexions restent bloquées jusqu’à confirmation.',
      'Chaque SMS est confirmé par un humain interne actif. Une clé de reprise est liée à l’acteur, au texte, au numéro et à la version de connexion. Le journal est écrit avant l’appel Telnyx. Réponse perdue, erreur serveur ou résultat impossible à enregistrer : vérifier Telnyx, jamais de nouvel envoi automatique. La reprise locale du navigateur ne renvoie pas un SMS déjà engagé.',
      'Une clé API agit pour son tenant avec sa portée. Elle n’est pas un mot de passe utilisateur.',
      'Les webhooks sortants passent par une file durable avec tentatives de livraison; vérifiez l’historique avant de rejouer.',
      'Un webhook entrant doit respecter son authentification et son mapping. L’idempotence évite certains doublons, pas toutes les erreurs de configuration.',
      'Un test de connexion peut réellement contacter le système externe. Testez d’abord avec un environnement de développement.',
      'À chaque envoi webhook ou EDI sortant, Pulsar vérifie les adresses réseau résolues et refuse les destinations privées, réservées ou de transition. La connexion utilise une adresse vérifiée, sans suivre les redirections HTTP. Configurez directement l’URL finale du destinataire.',
      'Le délai maximal d’un envoi, résolution DNS comprise, est de cinq secondes. Les détails réseau et le contenu de la réponse externe ne sont pas conservés dans les erreurs. Le statut HTTP et le résultat restent consultables.',
      'Désactiver un connecteur suspend aussi ses livraisons encore en attente; cela ne rappelle pas un envoi déjà parti. Réactiver conserve la file et exige à nouveau les droits métier de sa cible entrante, même sans changer sa configuration.',
    ],
    limits: [
      'Telnyx reste transactionnel : pas de campagnes, MMS, preuve de lecture, automatisations CRM ni nouvel outil IA. Accepté signifie pris en charge par l’API, pas livré. Livraison et réponses viennent de retours signés. Un STOP bloque ce numéro pour toute l’entreprise; START ne le réactive pas. Le consentement initial et les restrictions fournisseur restent à vérifier. Pas d’estimation de coût; plusieurs segments peuvent être facturés.',
      'ISAAC n’est pas encore un adaptateur actif de Pulsar. Son intégration demande le contrat API, les droits et un compte de test. Le chantier prévu sépare les positions du véhicule, ses affectations datées, le contenu justifié par manifeste/scans et les POD.',
      'Les formats et cibles pris en charge sont ceux exposés dans le catalogue de connecteurs. Un connecteur ne rend pas automatiquement tous les modules interopérables.',
      'Un test marqué Simulation valide seulement la configuration; seul un test réel contacte le destinataire. Une livraison dont la réponse est perdue peut être répétée : le destinataire doit dédupliquer X-Pulsar-Delivery. Pas de garantie de livraison exactement une fois.',
    ],
    example:
      'Créez une connexion à portée minimale, envoyez un événement de test et inspectez son statut et sa réponse.',
  },
  emails: {
    prerequisites: 'Transport courriel configuré et droits de lecture/envoi.',
    rules: [
      'Rédaction en texte simple ou HTML avancé : la conversion vers le texte retire la mise en forme après confirmation. Un gabarit ou brouillon IA chargé remplace l’éditeur, jamais l’inverse. L’envoi manuel demande confirmation des destinataires et annonce une mise en file, pas une livraison déjà prouvée.',
      'Configuration guidée Envoi / Réception / Vérification. Les préréglages Brevo et OVHcloud restent du SMTP; ils ne proposent pas OAuth. Le secret est conservé uniquement pour le même serveur et identifiant, sinon retiré sans remplacement. Les champs IMAP sont bornés; l’interface envoie une version pour empêcher une sauvegarde périmée.',
      'Répondre à est transmis au transport SMTP du tenant. Le statut du panneau décrit les valeurs enregistrées, l’aperçu décrit la saisie. Désactiver SMTP tenant revient au canal plateforme, pas à une interdiction globale d’envoi. Un SMTP tenant peut envoyer réellement même si EMAIL_DRIVER=log; vérifiez avant un test.',
      'Les gabarits, la composition et les messages existants ont un aperçu bureau/mobile isolé : scripts, navigation et images distantes bloqués. Le contenu original d’envoi n’est pas réécrit par l’aperçu, et les variables ne sont pas interpolées dans cet aperçu.',
      'Réception IMAP : choisissez collecte active et mode réel dans l’application, puis confirmez l’accès à la boîte. Aucun réglage EMAIL_DRIVER requis pour cette réception. Par défaut, les tests sont simulés. La migration laisse les anciennes boîtes en simulation jusqu’à une confirmation; le relevé actif est toutes les cinq minutes.',
      'Un gabarit prépare le contenu; l’envoi dépend du transport et des destinataires.',
      'En mode log, le message est journalisé et n’arrive pas dans une boîte externe.',
      'Les erreurs d’envoi doivent être examinées dans leur contexte avant une nouvelle tentative pour éviter les doublons.',
    ],
    limits: [
      'Un message présent dans l’application n’est pas une garantie de lecture ni même de livraison finale au destinataire.',
    ],
    example:
      'Testez un gabarit avec une adresse de test, vérifiez le mode de transport puis inspectez l’historique.',
  },
  settings: {
    prerequisites: 'Permissions d’administration pour les écrans concernés.',
    rules: [
      'Préparation du pilote : dans Administration SaaS → Exploitation, choisir Services, Transport ou Fabrication et inclure les agents seulement si nécessaires. Le choix ne change aucun module. Le précontrôle compare les migrations livrées à leur historique appliqué et distingue blocages, observations techniques et recette à vérifier. Une politique MFA ou un transport SMTP configuré ne prouve pas une connexion ni une livraison réelle. Exporter conserve un instantané daté, pas une certification.',
      'Les rôles sont propres à l’entreprise. Les permissions et l’activation des modules sont deux contrôles distincts.',
      'Les changements de permission deviennent visibles au rafraîchissement de session; reconnectez-vous si nécessaire.',
      'La plateforme et l’administration d’une entreprise sont des plans d’accès distincts.',
      'Conservez au moins un administrateur actif et consultez l’audit des mutations sensibles.',
      'Avant une mise à jour serveur, l’opérateur sauvegarde ensemble base, documents et clés de chiffrement, puis vérifie leur restauration dans un environnement séparé. Une sauvegarde présente ou un état de santé vert ne prouve pas qu’une restauration fonctionne.',
    ],
    limits: [
      'Le cache d’activation peut retarder brièvement une lecture. L’apparence personnelle se règle dans Personnalisation.',
      'Le précontrôle du pilote reste réservé aux opérateurs plateforme, sans contenu métier des entreprises. APS est requis seulement pour le profil Fabrication et Hermes seulement si l’IA est incluse. HTTPS, restauration, permissions, parcours métier, Finance, scanners et missions IA restent à tester sur leur environnement réel; aucune preuve externe n’est enregistrée par cet écran.',
      'La qualification Docker locale ne certifie ni le HTTPS du VPS, ni une copie hors serveur, ni les vrais lecteurs Zebra/USB, ni le fournisseur AI. Ces vérifications demandent une recette datée sur l’environnement concerné.',
    ],
    example:
      'Activez Services puis accordez services.read et services.manage à un rôle adapté; vérifiez l’accès avec le compte concerné.',
  },
  personalize: {
    prerequisites: 'Votre compte interne.',
    rules: [
      'Le thème, le fond et la disposition sont des préférences personnelles.',
      'Les applications visibles restent déterminées par vos permissions et celles de votre entreprise.',
      'Changer la disposition ne crée, ne supprime et ne désactive aucun module.',
    ],
    limits: ['Ces réglages ne modifient ni le portail client ni les règles métier.'],
    example:
      'Passez au thème sombre, ajustez la taille des icônes et réorganisez votre bureau sans changer celui de vos collègues.',
  },
};

export function knowledgeArticles(domains: NavDomain[]): KnowledgeArticle[] {
  return domains.flatMap((domain) => {
    const guide = MODULE_GUIDES[domain.key],
      detail = KNOWLEDGE_DETAILS[domain.key];
    if (!guide || !detail) return [];
    return [
      {
        ...guide,
        ...detail,
        rules: [
          ...detail.rules,
          ...(PARTY_INFORMATION_HELP[domain.key] ? [PARTY_INFORMATION_HELP[domain.key]] : []),
          ...(PARTY_INFORMATION_HELP[domain.key] ? [PARTY_WORKSPACE_HELP] : []),
        ],
        key: domain.key,
        title: domain.label,
        links: domain.sections.flatMap((s) => s.links),
      },
    ];
  });
}
/** Consumer-specific explanations; these describe delivered fields, not the future ERP roadmap. */
export const PARTY_WORKSPACE_HELP =
  'Dossier 360°, à côté de Fiche entreprise, permet de passer de l’identité à ses projets, interventions, devis, demandes SAV, factures clients et dossiers CRM/Transport autorisés. Clients reste facultatif : chaque module utilise sa façade. Seules les correspondances explicites directes actuelles sont suivies; aucun nom ou lien indirect ne fusionne l’historique. Les droits du document et le module sont contrôlés avant les compteurs. Recherche/pagination sont côté serveur; tous les statuts sont inclus. Ouvrir une ligne retrouve le dossier source exact, où restent les règles et actions. Aucun total monétaire ni paiement déduit. Les factures fournisseur, paiements et pièces restent dans leurs dossiers spécialisés.';
export const PARTY_INFORMATION_HELP: Record<string, string> = {
  clients:
    'Fiche entreprise rassemble raison sociale descriptive, immatriculation, site Web, références externes, langue, fuseau, disponibilité et consignes. Ajoutez jusqu’à 20 informations nommées. Dans Rapprochement, partez du registre Services/SAV : choisissez un client Transport/Facturation et/ou une société CRM, indiquez le motif, vérifiez puis confirmez. Les fiches et carnets ne fusionnent pas; le client lié peut orienter les prochaines factures Services.',
  transport:
    'Depuis Clients → Fiche entreprise, consultez les consignes d’accès/livraison et heures d’ouverture. Ce contexte interne ne remplace ni les Locations, ni les fenêtres de rendez-vous, ni les contraintes de chargement; il ne bloque pas le dispatch. Le rapprochement affiche seulement les identités directement liées et autorisées.',
  crm: 'Sur une société, Fiche entreprise complète le contexte commercial et permet de consulter les liens directs. Le rapprochement se confirme depuis le partenaire, sans copier les contacts ni les notes. Une conversion CRM ou une modification du client est refusée si elle contredit le client déjà lié au partenaire; aucun second client n’est créé pour contourner ce conflit.',
  catalog:
    'Sur un partenaire, Fiche entreprise conserve identité descriptive, références et consignes, partagées avec Services/SAV/Achats qui utilisent cette même fiche. Le rapprochement nécessite les droits sur chaque registre cible; les informations du client Transport ou de la société CRM ne sont jamais copiées automatiquement.',
  services:
    'Données → Clients → Fiche entreprise prépare les consignes d’intervention, disponibilité et référence externe. Rapprochement propose puis confirme les liens après relecture; le client de facturation ne peut plus changer après usage dans une facture Services. Le responsable de compte saisi ici n’est pas l’affectation d’un technicien.',
  support:
    'Données → Clients → Fiche entreprise permet de retrouver les consignes de relation avant de traiter une demande. Les renseignements restent partagés avec les autres consommateurs de cette fiche; aucun délai SLA, garantie ou autorisation de remboursement n’est déduit de ces notes.',
  purchasing:
    'Données → Fournisseurs → Fiche entreprise conserve immatriculation descriptive, référence fournisseur, interlocution et consignes de commande. Achats seul suffit. Ces consignes ne fixent ni prix, délai contractuel, taxes ou stock attendu. Les champs libres ne sont pas des coordonnées bancaires ni des instructions de paiement exécutables.',
  billing:
    'Données → Clients → Fiche entreprise expose les consignes de préparation et références administratives. Ce contexte ne réécrit pas la raison sociale/adresse figée sur une facture; aucun taux de taxe, terme de paiement ou plafond de crédit n’est appliqué depuis un texte libre.',
  'customer-portal':
    'La Fiche entreprise de l’administration interne conserve les consignes du compte sans les publier aux utilisateurs du portail. Ajouter une information ou rapprocher une fiche ne donne aucun accès externe et ne modifie pas les affiliations.',
};
export const normalizeKnowledgeSearch = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
export function matchesKnowledge(article: KnowledgeArticle, query: string) {
  const content = normalizeKnowledgeSearch(
    [
      article.title,
      article.purpose,
      article.connections,
      article.prerequisites,
      article.example,
      ...article.steps,
      ...article.rules,
      ...article.limits,
      ...article.links.map((l) => l.label),
      ...MODULE_CONNECTIONS.filter((c) => c.from === article.key || c.to === article.key).flatMap(
        (c) => Object.values(c),
      ),
    ].join(' '),
  );
  return normalizeKnowledgeSearch(query)
    .trim()
    .split(/\s+/)
    .every((term) => content.includes(term));
}
export function contextualGuides(article: KnowledgeArticle) {
  return article.links.flatMap((link) =>
    PAGE_GUIDES[link.href] ? [{ ...link, ...PAGE_GUIDES[link.href] }] : [],
  );
}
