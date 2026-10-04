export interface ModuleLesson {
  title: string;
  text: string;
  href?: string;
  target?: string;
}
/** Teaching scenarios, not automatic mutations. Each exercise runs in the real module. */
export const MODULE_LESSONS: Record<string, ModuleLesson[]> = {
  agents: [
    {
      title: 'Distinguer moteur, modèle et mission',
      href: '/agents',
      text: 'Un administrateur configure Connexion IA : version installée, fournisseur et modèle pour votre entreprise. Vérifier le runtime ne fait aucun appel au modèle : une session ouverte ne prouve pas encore qu’une mission métier sera correcte. Depuis le profil, vérifiez le rôle et le modèle de votre agent.',
    },
    {
      title: 'Limiter les outils au rôle',
      href: '/agents',
      text: 'Choisissez un agent, sa mission et seulement les outils métier nécessaires. Les droits, modules activés et outils autorisés se croisent. Le moteur ne reçoit pas le terminal ni les fichiers du serveur; un nouveau module n’ajoute pas automatiquement des capacités IA.',
    },
    {
      title: 'Commencer par les propositions',
      href: '/agents',
      text: 'Gardez l’agent en mode proposition pour la recette. Relisez ses sources et les paramètres avant approbation. Les plafonds métier ne sont pas un budget de tokens. Mesurez aussi exactitude, coût et délai avant de lui donner davantage d’autonomie.',
    },
    {
      title: 'Inspecter puis suspendre si nécessaire',
      href: '/agents',
      text: 'Consultez le run, ses outils et la décision enregistrée. Une pause est réversible et coupe les sessions actives; une révocation est définitive. Un moteur indisponible ne doit pas arrêter vos autres modules. Une mise à jour Hermes se qualifie séparément avant déploiement.',
    },
  ],
  connect: [
    {
      title: 'Choisir le canal adapté',
      href: '/connect',
      text: 'Les connexions sont communes à votre entreprise. Courriel utilise SMTP pour envoyer et IMAP pour recevoir; Telnyx utilise son API pour les SMS. Une connexion disponible n’active pas automatiquement une campagne ni une automatisation métier.',
    },
    {
      title: 'Préparer Telnyx sans envoyer',
      href: '/connect/sms',
      target: '[data-tour="sms-workspace"]',
      text: 'Ouvrez Configurer, indiquez votre numéro international, le Messaging Profile et la clé API. Ajoutez la clé publique Telnyx et l’adresse HTTPS Pulsar, puis copiez l’URL affichée dans le profil Telnyx pour recevoir les réponses. Commencez en simulation, choisissez un plafond, puis autorisez le réel ici avec confirmation, sans accès au serveur.',
    },
    {
      title: 'Relire puis confirmer le SMS',
      href: '/connect/sms',
      text: 'Saisissez le destinataire et le message, vérifiez l’aperçu, puis confirmez votre autorisation à contacter cette personne. Accepté ne veut pas dire livré : le journal affiche séparément la livraison signée. Si la réponse est perdue, reprenez la même demande, sans recréer le message. Consultez Réponses reçues et Désabonnements STOP; un STOP bloque ce numéro dans toute l’entreprise et START ne le réactive pas.',
    },
    {
      title: 'Inspecter les autres échanges',
      href: '/connect',
      text: 'Pour les webhooks et imports, ouvrez leur journal propre et examinez les erreurs avant de rejouer. Les droits, la signature et la portée du connecteur limitent les données accessibles. N’entrez jamais un secret dans une note ou dans une conversation IA.',
    },
  ],
  emails: [
    {
      title: 'Choisir fournisseur et identité',
      href: '/emails/config',
      target: '[data-tour="email-connection"]',
      text: 'Choisissez SMTP personnalisé, Brevo ou OVHcloud selon la région de votre compte. Les cartes sont des préréglages SMTP, pas OAuth. Brevo attend sa clé SMTP, différente de la clé API. Enregistrez l’expéditeur et Répondre à. Le panneau indique le canal enregistré; l’aperçu montre votre brouillon.',
    },
    {
      title: 'Séparer envoi et réception',
      href: '/emails/config',
      text: 'L’onglet Réception configure une boîte IMAP, pas l’envoi. Choisissez collecte active et mode réel, puis confirmez : aucun réglage serveur nécessaire. Sans mode réel, les tests restent simulés. Changer de serveur ou d’identifiant retire l’ancien secret sans remplacement. Désactiver le SMTP de l’entreprise réutilise le canal plateforme; ce n’est pas un arrêt global. Enregistrez avant le test.',
    },
    {
      title: 'Voir son gabarit avant utilisation',
      href: '/emails/templates',
      text: 'Créez ou modifiez un gabarit : le sujet et le corps apparaissent à côté en aperçu bureau/mobile. Les variables entre accolades ne sont pas remplacées par l’aperçu. Les images distantes et liens y sont bloqués; le rendu réel peut varier selon le logiciel de messagerie.',
    },
    {
      title: 'Rédiger et vérifier le résultat',
      href: '/emails',
      text: 'Composez un message, vérifiez destinataires et aperçu avant d’envoyer. Le journal montre le résultat du transport, pas une preuve de lecture. Pour une facture ou un avoir, utilisez l’envoi depuis le dossier métier afin de conserver ses contrôles et pièces justificatives.',
    },
  ],
  manufacturing: [
    {
      title: 'Figer une définition avant de produire',
      href: '/manufacturing/boms',
      text: 'Préparez les articles WMS, puis publiez une version de nomenclature après vérification des unités. Le suivi par lot se choisit à la création de chaque article. Une gamme décrit les opérations; publier une définition ne crée aucun stock.',
    },
    {
      title: 'Choisir le site et lancer l’ordre',
      href: '/manufacturing/orders',
      text: 'Sur un ordre brouillon, choisissez l’entrepôt et la version publiée. Libérez puis démarrez l’ordre avec son workflow. MRP et APS restent des calculs à examiner : ils ne consomment pas les composants et ne fabriquent aucun produit.',
    },
    {
      title: 'Identifier les matières réellement sorties',
      href: '/manufacturing/orders',
      text: 'Ouvrez Atelier et stock réel. Pour chaque composant, saisissez la quantité utilisée, l’emplacement et le lot si suivi. Ajouter un lot / emplacement répartit la consommation sur plusieurs sources. Le zéro doit être explicite et ne porte aucun lot. Vérifiez chaque quantité : un autre lot ne couvre jamais son manque.',
    },
    {
      title: 'Déclarer le bon produit et le rebut séparément',
      href: '/manufacturing/orders',
      text: 'Renseignez les quantités bonnes et rebutées, la destination et le lot produit si suivi. Un lot de sortie par déclaration; pour plusieurs lots, faites des déclarations distinctes. Créer la fiche du lot ne crée pas de stock. Confirmez les mouvements réels avec une note; après coupure, reprenez la même déclaration conservée, même clé et mêmes lots.',
    },
    {
      title: 'Lire la preuve matières vers produit',
      href: '/manufacturing/orders',
      text: 'Dans Déclarations et preuves WMS, comparez les lots matières et le lot produit. Le lien porte sur la déclaration, pas sur chaque pièce : aucune consommation antérieure n’est rattachée implicitement. Dans WMS → Lots → Traçabilité du lot, remontez les matières ou suivez les produits par niveaux. Les contrepassations sont exclues, les preuves anciennes et les limites signalées. Aucun stock pour le rebut, FEFO, quarantaine ou rappel réglementaire automatique.',
    },
    {
      title: 'Corriger une erreur sans effacer la preuve',
      href: '/manufacturing/orders',
      text: 'Dans l’atelier, choisissez la déclaration à corriger et examinez ses effets. La contrepassation retire le produit et restitue les matières aux emplacements et lots d’origine. Confirmez la situation physique et un motif. Stock insuffisant ou OF terminé : correction refusée. L’original reste visible; saisissez ensuite une nouvelle déclaration correcte. Après coupure, reprenez la même correction conservée.',
    },
  ],
  wms: [
    {
      title: 'Organiser les emplacements du site',
      href: '/wms/bins',
      text: 'Choisissez un entrepôt et ses emplacements. Les zones classent le plan; renommer une zone ne déplace pas le stock. Gardez un emplacement de réception pour vérifier l’arrivée avant rangement.',
    },
    {
      title: 'Choisir le suivi puis identifier les lots',
      href: '/wms/items',
      text: 'Sur un nouvel article, activez Suivi par lot seulement pour les parcours WMS/Achats compatibles. Ce choix est définitif. Ouvrez Lots : relevez numéro, lot fournisseur et dates sur l’étiquette. La fiche est immuable et ne crée pas de stock. Après réponse perdue, relisez le registre; ne recréez pas le lot.',
    },
    {
      title: 'Recevoir ce qui est réellement arrivé',
      href: '/wms/receiving',
      text: 'Ouvrez une réception, ajoutez article, emplacement, quantité et lot s’il est suivi. Une ligne correspond à un lot; ajoutez une ligne pour chaque lot distinct. Relisez le dossier puis validez : stock, solde du lot et journal sont enregistrés ensemble. Les arrivages saisis depuis Achats conservent séparément le nombre de colis.',
    },
    {
      title: 'Ranger puis préparer le lot choisi',
      href: '/wms/putaway',
      text: 'Choisissez source, article, lot disponible et destination; confirmez le déplacement. Après une coupure, reprenez la même demande conservée. En préparation, le stock d’un autre lot ne couvre pas votre ligne. La péremption reste une date à vérifier humainement, pas une règle FEFO automatique.',
    },
    {
      title: 'Compter chaque lot sans appliquer un ancien écart',
      href: '/wms/cycle-counts',
      text: 'Démarrez un comptage sur un emplacement calme : une ligne par article et lot, avec unité capturée. Renseignez toutes les lignes, zéro compris. Si un scan trouve plusieurs lots, choisissez celui de l’étiquette; +1 EA reste un brouillon. Enregistrez puis réconciliez. Tout mouvement sur cet emplacement invalide l’instantané : annulez et recomptez, sans appliquer l’ancien écart.',
    },
    {
      title: 'Retrouver la preuve et connaître les limites',
      href: '/wms/movements',
      text: 'Depuis Lots, ouvrez Traçabilité du lot : choisissez amont ou aval et une profondeur, puis un lot pour ses réceptions, préparations et pièces Services selon vos droits. Les déclarations atelier prouvent les liens; une préparation ne prouve pas une livraison et une limite signale un parcours partiel. Après réponse perdue à un ajustement, reprenez la demande conservée avec même clé, quantité et lot. Services conserve les retours; aucune allocation par pièce ni réservation.',
    },
    {
      title: 'Isoler un lot puis autoriser sa reprise',
      href: '/wms/items',
      text: 'Ouvrez Lots sur un article suivi. La quarantaine bloque les sorties du lot dans tous les entrepôts et l’exclut du MRP/APS matières; entrées et déplacements restent permis. Préparations à revoir montre les dossiers ouverts liés. Avec Qualité, préparez une inspection du lot puis citez son PASS dans une libération humaine, seulement si le lot n’a pas changé. Sans Qualité, documentez le contrôle manuel. Aucune inspection, correction atelier ou comptage ne contourne automatiquement le blocage.',
    },
    {
      title: 'Documenter une sortie sans libérer le reste du lot',
      href: '/wms/stock-exits',
      text: 'Depuis un lot, ouvrez Sorties documentées. Préparez quantité, emplacement et motif; autorisation et destination pour un retour. Avec Achats, rattachez facultativement une réception exacte. Le brouillon ne réserve rien. Examinez les effets puis confirmez la sortie physique; le reste conserve sa quarantaine. Ajoutez un justificatif, puis consignez les cumuls reçus, acceptés et refusés dans Suivi chez le fournisseur. Une correction garde le constat précédent. Après coupure, vérifiez ou reprenez la même déclaration, sans nouvelle clé. Un refus ne remet rien en stock; une acceptation ne crée pas d’avoir.',
    },
  ],
  catalog: [
    {
      title: 'Distinguer produit et prestation',
      href: '/catalog',
      text: 'Créez une identité avec son code, son type et son unité. Ces trois éléments restent fixes. Catalogue ne tient pas le stock et reste facultatif : les modules consommateurs entretiennent leurs fiches dans Données.',
    },
    {
      title: 'Décrire ce que l’équipe doit connaître',
      href: '/catalog',
      text: 'Ouvrez Fiche article : spécifications pour un produit, périmètre et livrables pour une prestation. Sur un produit, l’onglet Conditionnements définit par exemple 1 carton = 12 EA, avec code-barres et règle de colis entiers. Le contenu reste fixe; créez un autre format s’il change. Les dimensions descriptives ne servent jamais de conversion.',
    },
    {
      title: 'Relier les achats sans réécrire le passé',
      href: '/catalog',
      text: 'Dans Références fournisseurs, choisissez le fournisseur et ses conditions : référence, prix, devise, minimum, multiple, validité UTC et conditionnement. Dans Achats, appliquez-les explicitement à une ligne. Une version modifiée exige une nouvelle revue du brouillon; les commandes confirmées conservent leur copie. Le lien Stock WMS reste un choix distinct de même unité.',
    },
  ],
  crm: [
    {
      title: 'Partir de la société commerciale',
      href: '/crm/companies',
      text: 'La société CRM porte les opportunités et commandes. Elle fonctionne sans Transport, Clients ou Facturation. Ouvrez Fiche entreprise pour compléter son contexte commercial et consulter ses liens. Un nom identique ne crée aucun rapprochement automatique; les carnets restent distincts.',
    },
    {
      title: 'Préparer le carnet de la société',
      href: '/crm/companies',
      text: 'Ouvrez une société, puis Adresses et contacts du carnet. Ajoutez un site ou un interlocuteur, sa fonction et sa validité. Documents liés retrouve les commandes CRM qui ont choisi cette entrée; ouvrez un brouillon à revoir dans un nouvel onglet. Les copies engagées restent intactes. Ce carnet reste distinct des contacts de prospection et ne donne aucun accès portail ni consentement marketing.',
    },
    {
      title: 'Transformer une affaire en commande',
      href: '/crm/pipeline',
      text: 'Faites avancer une opportunité dans les étapes de votre pipeline. Une affaire gagnée avec des lignes peut préparer une commande brouillon. Vérifiez quantités, prix et devise : aucun stock n’est réservé par cette copie commerciale.',
    },
    {
      title: 'Choisir les coordonnées de l’accord',
      href: '/crm/sales-orders',
      text: 'Ouvrez une commande brouillon. Dans Coordonnées, choisissez séparément facturation, livraison et contact avec un motif. Le bouton Carnet de la société permet de compléter les données sur place. Une version changée ou expirée doit être revue avant confirmation.',
    },
    {
      title: 'Engager une version vérifiée',
      href: '/crm/sales-orders',
      text: 'Enregistrez les lignes et les choix avant de Confirmer. La confirmation fige les coordonnées et leur identité avec le statut. Une modification concurrente impose une relecture. Après une réponse incertaine, utilisez Vérifier le statut enregistré, sans renvoyer l’action.',
    },
    {
      title: 'Distinguer vente et exécution connectée',
      href: '/crm/sales-orders',
      text: 'Les lieux Transport, les demandes MRP et les factures gardent leurs propres validations et droits. La copie CRM ne les remplit pas implicitement. Les séquences de relance restent séparées du contact de cette commande et exigent des canaux configurés.',
    },
    {
      title: 'Relancer depuis la bonne opportunité',
      href: '/crm/deals',
      text: 'Ouvrez une opportunité puis Communications. Choisissez un contact de sa société, vérifiez son autorisation opérationnelle et relisez un modèle adapté. La confirmation crée un message dans cette opportunité, pas une campagne ni une séquence. Accepté ne signifie pas livré.',
    },
  ],
  transport: [
    {
      title: 'Choisir le prochain dossier de livraison',
      href: '/delivery-operations',
      target: '[data-tour="delivery-workspace"]',
      text: 'Le poste Exploitation livraison filtre les chargements et indique une prochaine vérification, sans rien exécuter. Ouvrez le dossier pour agir. Un incident ouvert, une nouvelle tentative, un retour autorisé et un retour reçu sont distincts; recevoir un retour ne crée ni stock ni remboursement. Les compteurs sont des colis et des dossiers, jamais une somme de pièces et de kilogrammes.',
    },
    {
      title: 'Du besoin commercial au mouvement réel',
      text: 'Une commande décrit la demande; une expédition est une unité de fret; un chargement organise son transport. Confirmer une commande ne crée pas de facture et ne prévient pas le client.',
    },
    {
      title: 'Préparer les lieux et les interlocuteurs',
      href: '/customers',
      text: 'Créez ou recherchez le client dans Transport. Son Carnet contient des adresses et contacts versionnés. Sur une entrée, Documents liés retrouve ses commandes et, avec les droits Facturation, ses factures capturées. Revoyez chaque brouillon concerné; une copie engagée ne change pas. Les lieux opérationnels restent séparés : une adresse de facturation ne doit pas déplacer un quai.',
    },
    {
      title: 'Revoir la commande avant de l’engager',
      href: '/transport-orders',
      text: 'Ouvrez une commande brouillon. Dans Coordonnées, choisissez les adresses et le contact de cet accord avec un motif. Un avertissement impose de revoir la version du carnet. Confirmer fige les choix et l’identité du client; aucun message ne part. Pour changer de client, retirez d’abord les choix du brouillon.',
    },
    {
      title: 'Planifier les unités de fret',
      href: '/transport-orders',
      text: 'Après confirmation, Planifier prépare une ou plusieurs expéditions. Contrôlez poids, palettes et fenêtres horaires. Toutes les lignes sont enregistrées ensemble : si une ligne est invalide, aucune n’est créée. Après une réponse incertaine, relisez les expéditions avant de recommencer.',
    },
    {
      title: 'Affecter et suivre l’exécution',
      href: '/dispatch',
      text: 'Affectez les expéditions à un chargement, vérifiez capacité et itinéraire, puis suivez le workflow de dispatch. Le connaissement utilise les lieux opérationnels, pas les coordonnées commerciales privées. La livraison et sa preuve restent des étapes distinctes.',
    },
    {
      title: 'Relier le contenu à ses sources explicites',
      href: '/loads',
      text: 'Dans un chargement, De la commande à la livraison relie une ligne entière de colis à sa commande CRM source, à sa préparation WMS terminée, ou aux deux. Transport seul fonctionne sans ces liens. L’unité WMS doit correspondre exactement; l’unité commerciale sans champ natif exige une attestation humaine 1:1. Aucun SKU ne crée un lien automatiquement. Libérez un lien avant engagement pour le corriger; le premier chargement fige son historique, y compris après retour.',
    },
    {
      title: 'Informer le client d’une expédition',
      href: '/shipments',
      text: 'Ouvrez une expédition enregistrée puis Communications. Choisissez explicitement une coordonnée du client de la commande, vérifiez l’autorisation et le mode simulation/réel. Le message ne déclare pas de livraison et ne remplace pas le POD. Consultez son résultat dans cet historique.',
    },
  ],
  clients: [
    {
      title: 'Une fiche partagée, pas un module imposé',
      text: 'Clients centralise l’entretien des identités. Transport, Services et Facturation continuent à fonctionner sans cette application. Rien ne sera créé par ce tutoriel.',
    },
    {
      title: 'Choisir le bon registre',
      href: '/clients',
      text: 'Transport et facturation contient les clients historiques; Services et SAV contient les partenaires. Recherchez avant de créer. Fiche entreprise ajoute références, consignes et informations nommées. Dans le registre Services/SAV, Rapprochement permet de choisir les fiches autorisées, vérifier et confirmer avec un motif; deux noms identiques ne sont jamais fusionnés automatiquement.',
    },
    {
      title: 'Distinguer qui paie et où livrer',
      href: '/clients',
      text: 'Ouvrez une fiche et renseignez séparément Facturation et Livraison par défaut. Le bouton Copier est explicite. Les sites et anciens documents ne sont jamais déplacés par cette modification.',
    },
    {
      title: 'Composer votre poste de travail',
      href: '/clients',
      text: 'Dépliez Colonnes et largeur, masquez les champs inutiles et glissez les séparations. Le clavier fonctionne aussi. Votre vue reste propre à votre compte et à cet appareil.',
    },
    {
      title: 'Retrouver le bon interlocuteur au bon moment',
      href: '/clients',
      text: 'Dans la ligne du client, ouvrez Carnet puis Adresses ou Contacts. Ajoutez une fiche avec sa fonction et sa période. La fin est exclue : au 1er octobre, une fiche terminant le 1er octobre est expirée. Documents liés montre les versions choisies sur les brouillons accessibles et les copies engagées conservées; un résultat vide ne prouve pas une absence d’usage ailleurs. Modifiez avec un motif puis consultez Historique. Aucun accès portail ni document ne change automatiquement.',
    },
    {
      title: 'Passer du client au dossier de travail',
      href: '/clients',
      target: '[data-tour="party-workspace"]',
      text: 'Sur la ligne d’un client, ouvrez Dossier 360°. Choisissez Projets, Interventions, Devis, SAV, Factures ou un dossier commercial selon vos modules et droits. Recherchez une référence puis ouvrez le document exact. Les compteurs incluent tous les statuts, pas seulement les actions à faire. Une facture masquée n’est pas une facture absente. Si une liaison manque, vérifiez Fiche entreprise → Rapprochement : aucun nom identique ni lien indirect ne rapproche des documents automatiquement. La consultation ne crée rien et n’active aucun module.',
    },
    {
      title: 'Lire les heures sans ambiguïté',
      text: 'Le bandeau affiche toujours votre fuseau. Cliquez dessus pour choisir un fuseau IANA ou suivre l’appareil. Les dates civiles restent fixes et les plannings métier annoncent leur propre fuseau.',
    },
    {
      title: 'Consigner la décision du contact',
      href: '/clients',
      text: 'Dans la fiche, ouvrez Communications et choisissez un canal et une coordonnée. Avec les droits de gestion, enregistrez la date et la preuve de la décision du contact. Elle vaut pour cette coordonnée dans l’entreprise, pas pour tous les contacts. Un STOP reste bloquant; aucun consentement marketing n’est déduit.',
    },
  ],
  billing: [
    {
      title: 'Conserver une facture reçue du fournisseur',
      href: '/billing/supplier-invoices',
      target: '[data-tour="supplier-invoice-register"]',
      text: 'Dans Factures fournisseur, créez ou choisissez le fournisseur sans activer Transport, Achats ou Entrepôt. Recopiez le numéro reçu, les dates civiles, les lignes nettes et les taxes déclarées. Conservez le justificatif original. Un lien explicite de ligne d’achat demande Achats et ses droits; il ne calcule pas le montant facturé. Enregistrez, relisez puis préparez la qualification : choisissez l’original et confirmez avec le droit dédié. Qualifiée signifie document figé, pas payée ou comptabilisée. Après coupure, vérifiez ou reprenez la même demande conservée.',
    },
    {
      title: 'Consulter le dossier d’un fournisseur',
      href: '/billing/suppliers',
      text: 'Dossiers fournisseur réunit factures, avoirs et pièces en lecture seule, même si le fournisseur est désactivé. Choisissez un fournisseur, filtrez les documents puis ouvrez leur dossier source. La synthèse porte sur tout l’historique qualifié, séparé par devise : ce reste documentaire n’est pas une dette à payer. Les justificatifs se téléchargent avec vos droits Finance; les liens Achats et WMS restent gardés dans les documents sources.',
    },
    {
      title: 'Réduire une facture avec un avoir reçu',
      href: '/billing/supplier-invoices',
      text: 'Ouvrez une facture fournisseur qualifiée puis Avoirs fournisseur. Saisissez numéro, date, motif et montants positifs par ligne et taxe; zéro signifie non concerné. Le reste créditable exclut les brouillons et ne représente pas une dette à payer. Conservez et sélectionnez l’original reçu, puis confirmez avec le droit de qualification d’avoir. Un retour WMS peut fournir une révision de contexte du même fournisseur, jamais un montant automatique. Une révision plus récente oblige à revoir le brouillon. Après coupure, rouvrez la facture et vérifiez ou reprenez le même avoir. Aucun stock, remboursement ou posting comptable.',
    },
    {
      title: 'Des opérations aux preuves financières',
      text: 'Bienvenue dans Facturation. Les factures, avoirs, paiements et écritures sont distincts. Un document financier ne déplace jamais à lui seul du stock et ne prouve pas un remboursement.',
    },
    {
      title: 'Convenir des échéances sans enregistrer un paiement',
      href: '/billing/supplier-schedules',
      target: '[data-tour="supplier-schedule-register"]',
      text: 'Ouvrez Échéancier fournisseur puis Planifier sur une facture qualifiée. Ajoutez des dates civiles croissantes et des montants dont la somme égale exactement le reste après avoirs qualifiés. Indiquez un motif, Examinez les effets puis confirmez la révision. Les prévisions restent séparées par devise et ne déduisent aucun paiement. Un nouvel avoir marque le planning À revoir et l’exclut des prévisions jusqu’à votre nouvelle confirmation. Retirer conserve les versions précédentes. Après réponse perdue, vérifiez ou reprenez la même confirmation. Une date dépassée ne prouve pas un impayé; cette opération ne comptabilise aucune dette.',
    },
    {
      title: 'Préparer les références légales et comptables',
      href: '/billing/config',
      text: 'Vérifiez devises, taxes et comptes. Pour les avoirs, renseignez le nom légal, l’adresse et les inscriptions fiscales de l’émetteur : ils seront proposés à la publication, puis confirmés et figés document par document.',
    },
    {
      title: 'Contrôler avant de valider',
      href: '/invoices',
      text: 'Ouvrez une facture et vérifiez ses sources, montants et taxes. Dans Coordonnées du document, choisissez les adresses et le contact du carnet avec un motif. Depuis le carnet, Documents liés retrouve les factures capturées à revoir; après approbation leur copie est conservée, même si le carnet change. Si À revoir apparaît, choisissez explicitement les versions à jour avant approbation. Le contact n’est pas le destinataire automatique des courriels; encaissements et avoirs restent distincts.',
    },
    {
      title: 'Publier la facture avant de la remettre',
      href: '/invoices',
      text: 'Après approbation, ouvrez Document et envoi de la facture. Vérifiez l’émetteur, choisissez sa copie de coordonnées figées ou justifiez la saisie manuelle, puis générez et téléchargez le PDF. Rien ne part automatiquement. Choisissez ensuite le courriel et confirmez le canal. La simulation et la mise en file ne changent pas le statut comptable; consultez l’historique de remise. Un ancien envoi impose une vérification opérateur.',
    },
    {
      title: 'Corriger avec un avoir motivé',
      href: '/invoices',
      text: 'Dans une facture client validée, ouvrez Avoirs et solde client. Sélectionnez les quantités, saisissez le motif, calculez le brouillon et vérifiez les taxes figées. Une personne disposant du droit de validation confirme la correction comptable. Le retour physique se fait ensuite séparément dans Services.',
    },
    {
      title: 'Figer le document destiné au client',
      href: '/invoices',
      text: 'Dans l’avoir validé, ouvrez Document et envoi client. Reprendre la copie de la facture conserve son identité et son adresse figées; une saisie différente demande un motif. Sans copie historique, confirmez une saisie actuelle. Vérifiez l’émetteur et les inscriptions fiscales, puis Figer et générer le PDF. Téléchargez-le avant envoi : les coordonnées sont définitives. Le courriel du contact figé reste un choix séparé à vérifier, jamais un envoi automatique.',
    },
    {
      title: 'Confirmer et contrôler la remise',
      href: '/invoices',
      text: 'Vérifiez le destinataire et le mode : simulation = aucun courriel; SMTP = envoi réel après confirmation avec le droit dédié. Actualisez l’historique. Accepté par le serveur ne garantit pas reçu; une remise incertaine ne doit jamais être renvoyée sans contrôle opérateur.',
    },
    {
      title: 'Contrôler les rapports dans la bonne devise',
      href: '/billing/reports',
      target: '[data-tour="ledger-currency"]',
      text: 'Choisissez explicitement la devise du rapport. Pulsar calcule les montants exacts sans additionner CAD et USD. Lisez la portée : les écritures sans devise sont exclues, jamais requalifiées automatiquement; le lien ouvre leur journal. Un total équilibré ne prouve pas la complétude. Les âgés montrent les soldes actuels classés par ancienneté d’approbation, pas un historique des paiements. Depuis Grand livre, une saisie manuelle exige date, devise, comptes équilibrés puis confirmation. Après coupure, vérifiez ou reprenez la même écriture conservée. Pas encore de change ou clôture de période; les factures fournisseur générales restent documentaires.',
    },
    {
      title: 'Choisir la cible et figer un budget',
      href: '/billing/accounting-profile',
      text: 'Dans Profil comptable, choisissez la cible de votre entreprise : Pulsar natif ou logiciel externe nommé, devise fonctionnelle cible et motif. Confirmez : aucune comptabilité officielle, conversion ou connexion externe n’est activée. Ouvrez Budgets, puis Nouveau budget : devise de transaction, dates inclusives, comptes et montants exacts. Sa période est figée même si les réglages changent. Consulter montre les exclusions et les révisions; Modifier peut archiver sans effacer. Un ancien budget non qualifié reste consultable : créez-en un nouveau explicitement. Après coupure, reprenez la même demande conservée.',
    },
    {
      title: 'Du plan d’un actif à sa dotation réelle',
      href: '/billing/fixed-assets',
      target: '[data-tour="fixed-assets-register"]',
      text: 'Dans Immobilisations, créez un brouillon avec devise, coût, résiduel, date, premier mois et comptes. Ouvrir montre le plan prévisionnel : relisez puis Figer et activer; ses paramètres deviennent immuables. Comptabiliser la prochaine dotation exige le droit dédié et attend la fin civile UTC du mois. Une période nulle reste tracée sans écriture. Comparez le plan avec Périodes réellement enregistrées et ouvrez le journal avec vos droits. Retirer du suivi demande un motif, mais ne comptabilise aucune cession. Les anciens dossiers non qualifiés restent consultables. Après coupure, reprenez exactement la demande conservée.',
    },
    {
      title: 'Reprendre une devise historique sur preuve',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Depuis Reprise du journal, sélectionnez une écriture manuelle sans devise. Paiements, factures et dotations enregistrées disposent de leur rapprochement source; le plan futur des anciens actifs reste bloqué. Conservez un justificatif, choisissez la devise, la preuve et le motif. Préparer la revue montre l’effet sur les rapports et budgets; confirmez avec le droit spécifique. L’écriture originale reste inchangée. Une correction exige d’abord un retrait motivé, qui remet l’écriture dans les exclusions sans contrepassation, puis une nouvelle revue. Même une ancienne période utilise la qualification actuellement confirmée. Après coupure, vérifiez ou reprenez exactement la même demande conservée.',
    },
    {
      title: 'Reprendre un paiement avec sa contrepassation',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Ouvrez l’original du paiement historique dans Reprise du journal. Vérifiez le montant déclaré, le montant affecté et comptabilisé, puis la portée : original seul ou original avec contrepassation. La devise est celle du paiement et doit être attestée par votre pièce. Conservez la preuve, motivez, préparez la revue puis confirmez. Une future annulation reprendra les comptes originaux et la même qualification. Un retrait exclut toutes les écritures liées ensemble; retirez d’abord tout rapprochement bancaire. Depuis une contrepassation, Revoir avec le paiement original vous ramène au bon dossier. Les dossiers incohérents restent bloqués. Aucun solde de facture ni devise originale n’est réécrit.',
    },
    {
      title: 'Reprendre une facture avec ses avoirs',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Ouvrez l’écriture originale de la facture client ou transporteur. Vérifiez le hors taxes, les taxes figées, le total et les avoirs émis. La devise source est en lecture seule; conservez une preuve, motivez puis préparez et confirmez la revue. La décision couvre ensemble l’original et ses avoirs historiques sans devise. Depuis un avoir, Revoir avec la facture originale ramène à ce dossier. Un avoir déjà à devise connue reste inchangé et bloque le retrait isolé de la qualification. Un nouvel avoir émis après reprise garde sa devise connue. La qualification ne crée jamais une écriture manquante, ne recalcule pas les taux et ne change aucun solde. Une incohérence demande une revue comptable, pas une devise devinée.',
    },
    {
      title: 'Distinguer le reste non affecté d’un paiement',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Dans la synthèse du paiement, comparez Montant déclaré, Affecté et comptabilisé et Reste non comptabilisé. Par exemple, 15,01 déclarés et 12,34 affectés laissent 2,67 hors journal. Conservez une preuve attestant la devise de la portion affectée. Préparer la revue rappelle cette limite avant confirmation. La qualification ne crée ni crédit client ni avance fournisseur et ne complète pas les affectations. Le rapprochement bancaire reste bloqué pour ce paiement partiel. Une annulation inverse seulement les lignes réellement postées; le retrait exclut original et contrepassation ensemble. Après coupure, reprenez la même demande conservée, jamais une nouvelle clé.',
    },
    {
      title: 'Reprendre un montant transporteur accepté',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Après un litige, les lignes attendues peuvent différer du payable accepté. Dans Reprise du journal, l’encadré Montant transporteur accepté montre la référence reçue, les lignes attendues et reçues, les taxes figées et l’écart du payable. Exemple : 100 attendus, 15 de taxes conservées et 120 acceptés donnent 105 hors taxes comptabilisés; l’écart du payable est 5, pas l’écart de lignes de 20. L’acceptation ACCEPT_INVOICED doit être retrouvée dans l’historique et le journal doit déjà correspondre au payable. Conservez une preuve du dossier ajusté, motivez puis confirmez la revue. Aucun taux, montant, règlement ou ligne attendu n’est réécrit. Une décision absente ou ambiguë reste bloquante; ne devinez pas une ventilation. Après coupure, reprenez la même demande conservée.',
    },
    {
      title: 'Reprendre les dotations d’une immobilisation',
      href: '/billing/ledger-qualification',
      target: '[data-tour="ledger-qualification"]',
      text: 'Dans Immobilisations, ouvrez un ancien actif puis Reprendre les dotations historiques. Vérifiez le coût enregistré, le résiduel, le cumul et chaque période réellement comptabilisée. Les mois absents ne sont jamais ajoutés. La devise n’est pas déduite : choisissez celle attestée par le justificatif couvrant tout le groupe. Préparez puis confirmez la revue : toutes les dotations de cet actif sont qualifiées ensemble. Le retrait les exclut ensemble, sans contrepassation. L’actif, les périodes et les journaux originaux restent inchangés; le plan futur reste bloqué. Un journal manquant ou incohérent demande une reprise spécialisée. Accès lecture Immobilisations et Journal requis, avec qualification pour décider. Après coupure, reprenez la même demande conservée.',
    },
  ],
  services: [
    {
      title: 'Du besoin client aux travaux prouvés',
      text: 'Bienvenue dans Services. Reliez votre accord commercial, les interventions, les heures et pièces utilisées. Les comptes, absences, stocks et factures restent dans leurs modules spécialisés.',
    },
    {
      title: 'Chiffrer puis accepter le devis',
      href: '/services/quotes',
      text: 'Choisissez un client et une prestation, puis enregistrez le brouillon. Dans Coordonnées du document, sélectionnez une adresse et un contact du carnet avec un motif. Depuis Services → Données → Carnet, Documents liés ouvre les devis utilisant cette entrée dans un nouvel onglet. Si le carnet change, revoyez les versions avant acceptation. L’accord fige les coordonnées et crée un projet à activer. Catalogue n’est pas requis; aucun message client ne part.',
    },
    {
      title: 'Choisir l’exigence d’acceptation',
      href: '/services',
      text: 'Dans le projet brouillon, choisissez Exiger l’acceptation des travaux avant activation. Ce choix reste facultatif et les projets existants ne sont pas modifiés. S’il est exigé, chaque intervention terminée devra être acceptée avant facturation de ses sources et clôture du projet.',
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
      title: 'Sortir et retourner les bonnes pièces',
      href: '/services/interventions',
      text: 'Dans une intervention en cours, ouvrez Pièces et stock. Choisissez produit, emplacement puis lot si demandé; vérifiez son stock et saisissez quantité et utilisation. Confirmez la sortie physique. Pour un retour partiel, la carte conserve le même lot et emplacement : indiquez quantité et motif. Une pièce facturée exige un avoir validé. Après coupure, reprenez la demande conservée, sans changer sa clé ni son lot. Les dates du lot sont informatives, sans FEFO.',
    },
    {
      title: 'Recueillir l’acceptation des travaux',
      href: '/services/interventions',
      text: 'Ouvrez une intervention terminée, onglet Acceptation. Examinez le rapport puis consignez le représentant du client, la référence de l’échange et ses réserves ou son acceptation sans réserve. Le droit services.work.accept est distinct de la gestion du planning. Les réserves restent dans l’historique; l’acceptation finale est immuable. Il s’agit d’une déclaration interne, pas d’une signature électronique.',
    },
    {
      title: 'Préparer la facture depuis le projet',
      href: '/services',
      text: 'Dans le projet, sélectionnez les heures approuvées ou pièces consommées et confirmez les tarifs. Dans Données → Fiche entreprise → Rapprochement, vérifiez le client Facturation lié au partenaire. Confirmez les liens avec un motif; les profils et carnets ne fusionnent pas. Une source ne peut être facturée deux fois. Taxes, approbation et envoi restent dans Facturation.',
    },
    {
      title: 'Facturer puis corriger sans effacer',
      href: '/services',
      text: 'Dans Travaux à facturer, les sources bloquées indiquent comment terminer ou faire accepter leur intervention. Choisissez seulement les travaux prêts et vérifiez les prix. Une facture validée se corrige par avoir; le retour physique de pièces reste une opération distincte. Une nouvelle difficulté après acceptation passe par le SAV ou une nouvelle intervention, sans réécrire l’accord.',
    },
    {
      title: 'Utiliser un agent avec des sources',
      href: '/services/planning',
      text: 'Le Coordinateur Services et SAV lit les dossiers et prépare des propositions. Les services vérifient encore droits, versions et contraintes à l’exécution. Pas de décision RH, approbation de temps ni envoi client avec ces outils.',
    },
    {
      title: 'Confirmer une intervention au client',
      href: '/services/interventions',
      text: 'Enregistrez les changements de l’intervention puis ouvrez Communications. Choisissez un destinataire du client du projet, préparez un message et relisez l’aperçu. Sans SMTP tenant actif le courriel est simulé. Une réponse perdue se vérifie avec la même demande; elle ne déclenche pas de nouveau SMS. L’horaire et l’acceptation des travaux restent des actions distinctes.',
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
      text: 'Créez une inspection depuis un plan actif. Choisissez sa source avant de contrôler : réception WMS validée, lot, ordre de fabrication ou SAV. Pour un lot, partez aussi de Articles → Lots → Préparer un contrôle. L’identité et les mouvements sont capturés; impossible de rattacher après coup une inspection à un autre lot.',
    },
    {
      title: 'Mesurer puis constater le résultat',
      href: '/quality',
      text: 'Démarrez, renseignez chaque critère, vérifiez les unités puis terminez. Un échec ouvre une non-conformité; une mesure manquante n’est jamais une réussite. Pour un lot, tout mouvement ou nouvelle décision depuis la préparation oblige à refaire le contrôle. Un PASS ne libère rien : retournez au lot WMS pour une décision humaine, en citant le contrôle conforme si son contexte reste inchangé.',
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
      text: 'Choisissez le client; s’il manque, ajoutez-le dans le sélecteur sans quitter votre demande. SAV → Données → Fiche entreprise donne ses consignes et sa disponibilité, sans activer Catalogue. Ces informations ne définissent pas un SLA. Décrivez symptôme, résultat attendu et priorité; ne promettez pas de garantie non vérifiée.',
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
      text: 'Dans Données, créez fournisseur et article sans activer Catalogue. Fiche article regroupe les spécifications, Conditionnements (ex. carton de 12 EA et code-barres) et Références fournisseurs. Prix, minimum et multiple restent par unité de base. Stock WMS est un lien explicite séparé vers un article actif de même unité.',
    },
    {
      title: 'Composer puis figer la commande',
      href: '/purchasing',
      text: 'Choisissez fournisseur et article puis Appliquer ces conditions pour reprendre la référence et le prix. Appliquer le conditionnement est un choix distinct : 2 cartons × 12 EA = 24 EA, toujours au prix par EA. Vérifiez quantité, minimum, multiple et devise. Une version modifiée doit être resélectionnée. Enregistrez puis confirmez : copies figées, aucun stock ni courriel automatique.',
    },
    {
      title: 'Identifier le fournisseur de cet accord',
      href: '/purchasing',
      text: 'Dans la commande enregistrée, ouvrez Carnet du fournisseur pour ajouter une adresse ou un interlocuteur. Documents liés distingue ses commandes brouillons des copies déjà engagées; ouvrez un dossier à revoir dans un nouvel onglet. Choisissez les versions dans Coordonnées du document avec un motif. Il s’agit du fournisseur, pas de votre entrepôt de réception. Confirmer fige la copie. Pour changer de fournisseur, retirez les choix. Après une réponse perdue, vérifiez la commande enregistrée sans renvoyer l’action.',
    },
    {
      title: 'Organiser les arrivages',
      href: '/purchasing',
      text: 'Utilisez les files À préparer, Arrivages à suivre et Échéance dépassée. Ouvrez une commande confirmée pour voir les quantités commandées, reçues et restantes par ligne. Un retard ne prouve pas un manque : consultez le reliquat.',
    },
    {
      title: 'Enregistrer une réception partielle',
      href: '/purchasing',
      text: 'Dans Réceptions, scannez le code capturé pour retrouver la ligne : le scan ne remplit ni quantité ni stock. Saisissez les cartons réellement arrivés et vérifiez 1 × 12 = 12 EA; ou saisissez des pièces pour un carton ouvert. Choisissez entrepôt, emplacement, référence et lot si l’article WMS le suit. Le lot est distinct du carton. Confirmez l’arrivée physique; après réponse perdue, reprenez la demande conservée avec le même lot.',
    },
    {
      title: 'Traiter le reliquat avant clôture',
      href: '/purchasing',
      text: 'Consultez l’historique et le reste par ligne. Clôturer un reliquat exige un motif et ne crée pas de stock. Avec WMS, Retours liés à cette commande ouvre les sorties rattachées à sa réception. Dans le retour, Suivi chez le fournisseur garde séparément les cumuls reçus, acceptés et refusés avec un justificatif, puis les corrections historisées. Le reçu d’achat ne diminue jamais; ces constats ne créent pas d’avoir. Rapprochement facture et envoi restent séparés.',
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
