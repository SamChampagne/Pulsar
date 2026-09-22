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
    ],
    limits: [
      'Les liens sont choisis depuis Qualité; aucun déclenchement automatique ou compteur qualité sur les dossiers sources. Le détail source est masqué si le module ou son droit de lecture manque; le titre libre saisi dans Qualité reste visible aux lecteurs Qualité.',
      'Aucune quarantaine physique, réservation, libération de stock, traçabilité lot/série, plan d’échantillonnage statistique, signature, certification ou contrôle métrologique. La vérification du format des preuves ne constitue pas une analyse antivirus.',
      'Les plans sont génériques, sans correspondance directe à un produit Catalogue ni héritage automatique dans les nomenclatures. Les unités sont explicites, mais non converties.',
      'Aucun coût de non-qualité, retour fournisseur, remboursement, notification ou outil AI. Fermer une non-conformité ne corrige ni le stock ni le SAV ni la fabrication. Le responsable reste un utilisateur Accès, sans exposition de son dossier RH.',
    ],
    example:
      'Plan Contrôle pièce : aspect conforme et diamètre de 9,8 à 10,2 mm. Créer un contrôle lié à l’ordre de fabrication, démarrer, mesurer 10,4 mm puis enregistrer. Terminer ouvre une NC. Documenter le réglage de la machine, déclarer l’action réalisée, vérifier une nouvelle pièce et consigner la preuve dans le motif de clôture. Le contrôle initial reste non conforme; la contre-mesure peut faire l’objet d’un nouveau contrôle.',
  },
  support: {
    prerequisites:
      'Activer SAV, attribuer support.read/manage et préparer les clients dans Catalogue. Relier une intervention exige également Services activé et services.read.',
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
      'Le code est unique par entreprise. Une fiche peut être corrigée ou désactivée, jamais supprimée par cette interface.',
      'Un partenaire doit être client, fournisseur ou les deux. Les nouvelles commandes ne sélectionnent que les fournisseurs actifs; les projets, que les clients actifs.',
      'Produits et prestations partagent une identité, pas un stock. Le type, le code et l’unité sont immuables après création pour éviter de réinterpréter les dossiers existants.',
      'Les modifications concurrentes sont refusées : rechargez la fiche si un collègue l’a changée.',
      'Les applications consommatrices disposent de sélecteurs limités aux noms, codes et unités nécessaires, sans accès aux coordonnées complètes.',
    ],
    limits: [
      'Les anciens clients TMS, sociétés CRM, produits CRM et articles WMS ne sont ni copiés ni fusionnés automatiquement.',
      'Seuls les produits GOODS peuvent être reliés explicitement à un article WMS actif de même unité via Stock WMS. Les sociétés/produits CRM et clients Transport restent séparés. Un code identique ne crée pas de lien.',
    ],
    example:
      'Créez « Inspection annuelle » comme prestation en heures, puis sélectionnez-la dans une intervention. Un même partenaire peut aussi fournir des pièces dans Achats.',
  },
  purchasing: {
    prerequisites:
      'Activer Achats fournisseurs; préparer au moins un fournisseur et un article dans Catalogue. Droits purchasing.read/manage.',
    rules: [
      'Le numéro PO est attribué automatiquement et reste unique dans l’entreprise.',
      'Un brouillon comporte de 1 à 100 lignes. Chaque quantité est strictement positive et le prix unitaire ne peut pas être négatif.',
      'Chaque commande a une seule devise. Le total hors taxes utilise les quantités et prix, avec un calcul décimal côté serveur.',
      'La confirmation revérifie que fournisseur et articles sont actifs. Les libellés et unités enregistrés sur les lignes sont conservés.',
      'Après confirmation, les lignes ne sont plus modifiables. Réceptions et reliquats enregistre les arrivages physiques; annuler devient interdit après une réception. Une clôture avec produits manquants exige un motif.',
      'Réceptionner exige purchasing.read/manage, wms.read/manage et Entrepôt activé. Chaque produit doit être relié par Catalogue à un article WMS actif de même unité. Les prestations restent hors stock.',
      'Un arrivage crée et valide une réception WMS et ses liens de lignes dans la même transaction. Les champs personnalisés de réception WMS sont proposés et validés. Le reçu et le reste sont calculés depuis ces lignes, sans addition de produits ou unités différents. Le dépassement de commande est refusé.',
      'Après une réponse perdue, reprendre la réception conservée avec sa même clé. La commande reste confirmée après réception complète : la clôture administrative est explicite.',
      'Un enregistrement ou une transition utilise la version lue : un changement concurrent provoque un conflit, pas un écrasement.',
    ],
    limits: [
      'Aucun envoi fournisseur, taxe, facture ou paiement automatique. Seule la confirmation explicite d’un arrivage crée son stock.',
      'Retours fournisseur, sur-réception tolérée, lots/séries et rapprochement facture restent à développer. Une ancienne réception WMS indépendante ne se rattache pas automatiquement. Quantités reçues : trois décimales; aucune conversion d’unité.',
      'La clôture signifie uniquement que le suivi administratif est terminé. Ce n’est pas une preuve de réception.',
      'Les achats ne sont pas encore reliés à un projet, une demande MRP ou une réservation de stock.',
    ],
    example:
      'Commander 10 joints, confirmer, recevoir 4 joints via Réceptions et reliquats : reçu 4, restant 6. Réceptionner les 6 suivants dans un nouvel arrivage, ou clôturer le reliquat avec un motif si le fournisseur ne livrera pas le solde.',
  },
  services: {
    prerequisites:
      'Activer Services; créer un client dans Catalogue. Droits services.read/manage. Une prestation de catalogue est facultative.',
    rules: [
      'Devis : choisir un client Catalogue, des articles/prestations et une devise. Accepter le dernier brouillon enregistré fige les lignes et crée un unique projet brouillon, de manière idempotente. Un devis expiré ne peut pas être accepté. Annulation et acceptation sont définitives; aucun envoi ni signature externe.',
      'Planning : la vue jour/semaine utilise le fuseau d’entreprise (America/Toronto par défaut, réglable dans Mon travail). Le glisser-déposer ouvre un panneau de confirmation. Une version périmée, un chevauchement avec durée connue, une absence approuvée ou des qualifications insuffisantes sont refusés sous verrou, y compris depuis les autres writers d’intervention.',
      'Les exigences de compétences sont propres à l’intervention, éventuellement complétées par celles d’un poste Fabrication. La couverture doit durer tout le créneau. Ce lien ne réserve jamais de capacité APS. Une absence approuvée ou une révocation postérieure peut invalider un planning déjà enregistré : recontrôler avant exécution.',
      'Facturer : relier explicitement le partenaire au client Facturation dans Catalogue → Partenaires → Connexions. Le lien CRM est facultatif et doit être cohérent avec son client existant. Rien n’est rapproché automatiquement par nom. Le client du projet ne peut plus changer après un devis accepté ou une facturation.',
      'Le panneau Travaux à facturer sélectionne les heures APPROVED facturables et les pièces consommées non retournées. Les quantités sont relues; les tarifs sont confirmés par l’utilisateur et figés. Une contrainte unique empêche de facturer deux fois chaque source. La clé de demande conservée permet de reprendre un envoi sans dupliquer la facture.',
      'La facture créée est un brouillon dans Facturation, sans taxe implicite, approbation ou envoi. Supprimer ce brouillon libère les sources mais conserve la trace de la demande. Une heure facturée ne se rouvre pas; une pièce facturée ne se retourne pas silencieusement. Après approbation financière, le circuit intégré d’avoir/correction reste à construire.',
      'AI : les outils business_attention, services_planning/get_job/check_slot/billable_context et support_case_context lisent les sources autorisées. services_schedule_job et support_set_followup passent par le registre et ProposedAction, avec versions et contrôles métier réévalués. Le rôle Coordinateur Services et SAV est proposé en autonomie PROPOSE, interactif, sans réveil automatique sur ces alertes.',
      'Le projet regroupe le travail pour un client. Il commence en brouillon, passe en cours, puis terminé ou annulé.',
      'Activez un projet avant d’y créer une intervention. Chaque intervention possède son propre numéro INT et son propre état.',
      'Une intervention planifiée peut démarrer ou être annulée. Une intervention en cours peut être terminée ou annulée. Les états fermés sont définitifs dans cette version.',
      'Terminer exige un compte rendu non vide. Sa date de complétion est enregistrée côté serveur.',
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
      'La consommation et le mouvement WMS sont atomiques. Un retour intégral motivé crée un mouvement inverse vers l’emplacement d’origine, sans effacer la sortie. Le retour reste possible après fin de l’intervention tant que le projet est actif; l’emplacement doit être actif. Le projet fermé fige les pièces.',
      'Une intervention avec des pièces non retournées ne peut pas être annulée : retournez-les si elles sont physiquement revenues, ou terminez avec un rapport si elles ont réellement été utilisées. Changer la correspondance Catalogue ne réécrit jamais les pièces passées.',
    ],
    limits: [
      'Pas encore d’approbation par semaine ou en lot, circuit multi-niveaux, relances automatiques, chronomètre, équipe multi-intervenants, optimisation de capacité, forfaits, acomptes, avoirs Services intégrés ou signature client. Les retours de pièces sont intégraux. La reprise après coupure n’est pas un mode hors ligne complet.',
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
      'La commande décrit la demande; les expéditions décrivent les flux; le chargement regroupe les expéditions et leurs ressources.',
      'Les changements d’état passent par les actions du dossier. Une édition de texte n’est pas une transition de transport.',
      'Une modification de tarif, distance ou composition du chargement entraîne une réévaluation du coût avant clôture. Le coût d’un chargement terminé reste figé.',
      'Les corridors sont comparés par spécificité. Les tables de carburant sont des surcharges appliquées aux tarifs, pas un journal d’achats de carburant.',
      'Une carte affiche un itinéraire; sa géométrie n’est pas une base de facturation. Une distance manuelle n’est pas remplacée par le routage.',
      'Désactiver un partenaire conserve ses dossiers historiques.',
    ],
    limits: [
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
      'Le journal des mouvements est la source de vérité du stock. Un mouvement et son solde sont enregistrés ensemble.',
      'Les sorties vérifient le stock disponible. Même un ajustement explicite ne peut rendre un emplacement négatif.',
      'Une réception ou préparation est versionnée. Corriger une ligne ne réserve pas de stock : la disponibilité est vérifiée à la validation.',
      'Une zone classe visuellement les emplacements. La renommer ne déplace pas le stock; utilisez Rangement pour un mouvement réel.',
      'Un scan sélectionne un article ou emplacement. Dans un comptage, +1 concerne un brouillon en unités EA, pas le stock publié.',
      'Après une réponse incertaine à un déplacement, reprenez la même opération conservée. Ne recréez pas un mouvement supposé manquant.',
    ],
    limits: [
      'Pas de traçabilité complète par lot, péremption, conversion automatique d’unités ni réservations dans ce lot.',
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
    ],
    limits: [
      'La disponibilité de la planification dépend du moteur APS. Une indisponibilité ne signifie pas que les données de fabrication sont perdues.',
      'Ce guide correspond à la branche courante : ne présumez pas la présence d’un MRP complet, de réception partielle ou de traçabilité process.',
    ],
    example:
      'Préparez calendrier et poste, composez gamme et nomenclature, créez l’ordre puis examinez son placement dans l’échéancier.',
  },
  yard: {
    prerequisites: 'Site, emplacements de cour et quais; rendez-vous ou visite.',
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
    prerequisites: 'Véhicules/remorques, plans et documents de conformité.',
    rules: [
      'La maintenance réutilise le parc transport, sans le dupliquer.',
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
    prerequisites: 'Devises, taxes, comptes et permissions adaptés à chaque action financière.',
    rules: [
      'Une facture transporteur est rapprochée contre le coût figé du chargement, jamais contre un recalcul courant.',
      'L’audit de fret calcule les écarts de manière déterministe. Un agent peut proposer un traitement, pas inventer un écart.',
      'L’approbation, l’envoi, le paiement et le rapprochement sont des opérations distinctes.',
      'Un paiement rapproché ne peut pas être simplement annulé; il faut respecter le parcours de correction.',
      'Le rapprochement bancaire vérifie notamment montant, sens et devise. Un lien de dossier ne crée pas à lui seul une écriture.',
    ],
    limits: [
      'Les nouvelles commandes fournisseurs n’alimentent pas encore ces factures.',
      'Les rapprochements partiels, groupés et traitements de change demandent des fonctions dédiées.',
    ],
    example:
      'Ouvrez l’écart d’une facture, examinez le coût attendu, résolvez le litige puis suivez le paiement dans son dossier.',
  },
  crm: {
    prerequisites:
      'Pipeline et étapes, entreprises et contacts; connecteurs configurés pour communiquer.',
    rules: [
      'Les étapes configurées structurent les opportunités et les déclenchements d’automatisation.',
      'Une automatisation doit être comprise avec son déclencheur, ses conditions et son canal de communication.',
      'Les coordonnées et accès au portail client ne sont pas nécessairement la même identité : une fiche contact n’est pas un compte utilisateur.',
      'Les actions réelles des agents restent soumises aux droits, plafonds et approbations configurés.',
    ],
    limits: [
      'Les produits CRM et le nouveau Catalogue ne sont pas synchronisés automatiquement.',
      'Ne lancez pas des séquences sur de vrais destinataires pour tester sans vérifier le transport de courriel et les règles de consentement applicables.',
    ],
    example:
      'Qualifiez une opportunité dans une étape du pipeline, vérifiez son contact et préparez la prochaine relance.',
  },
  agents: {
    prerequisites: 'Runtime et fournisseur configurés pour le tenant, rôle et outils autorisés.',
    rules: [
      'Un agent ne dispose que de l’intersection entre ses permissions, les modules activés et sa liste d’outils.',
      'Les mutations passent par la gouvernance des actions proposées. L’autonomie ne supprime pas les plafonds de montant et de débit.',
      'Les actions automatiquement approuvées restent enregistrées et auditables.',
      'Pause arrête le travail de façon réversible; la révocation est permanente.',
      'Un circuit de sécurité peut ramener l’agent en mode proposition. La promotion d’autonomie exige une confirmation humaine.',
      'Un runtime indisponible ne doit pas arrêter le cœur de Pulsar. Consultez le run et sa raison d’échec ou de saut.',
    ],
    limits: [
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
      'Une clé API agit pour son tenant avec sa portée. Elle n’est pas un mot de passe utilisateur.',
      'Les webhooks sortants passent par une file durable avec tentatives de livraison; vérifiez l’historique avant de rejouer.',
      'Un webhook entrant doit respecter son authentification et son mapping. L’idempotence évite certains doublons, pas toutes les erreurs de configuration.',
      'Un test de connexion peut réellement contacter le système externe. Testez d’abord avec un environnement de développement.',
    ],
    limits: [
      'Les formats et cibles pris en charge sont ceux exposés dans le catalogue de connecteurs. Un connecteur ne rend pas automatiquement tous les modules interopérables.',
    ],
    example:
      'Créez une connexion à portée minimale, envoyez un événement de test et inspectez son statut et sa réponse.',
  },
  emails: {
    prerequisites: 'Transport courriel configuré et droits de lecture/envoi.',
    rules: [
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
      'Les rôles sont propres à l’entreprise. Les permissions et l’activation des modules sont deux contrôles distincts.',
      'Les changements de permission deviennent visibles au rafraîchissement de session; reconnectez-vous si nécessaire.',
      'La plateforme et l’administration d’une entreprise sont des plans d’accès distincts.',
      'Conservez au moins un administrateur actif et consultez l’audit des mutations sensibles.',
    ],
    limits: [
      'Le cache d’activation peut retarder brièvement une lecture. L’apparence personnelle se règle dans Personnalisation.',
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
        key: domain.key,
        title: domain.label,
        links: domain.sections.flatMap((s) => s.links),
      },
    ];
  });
}
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
