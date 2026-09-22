# Scanners et tutoriels de première utilisation

Lot local du 21 septembre 2026, branche `codex/end-user-workflows`. Complète
[le lot utilisabilité](end-user-workflows.md). Aucun push ni déploiement distant.

## Périmètre livré

| Espace                | Codes reconnus                                               | Usage disponible                                                                                        |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Entrepôt / inventaire | Code-barres article ou SKU exact; code emplacement           | Recherche depuis l’en-tête; sélection dans les pickers de réception, préparation et rangement; comptage |
| Fabrication           | Numéro d’ordre de fabrication; articles WMS dans les pickers | Ouvrir un ordre; sélectionner les articles sans quitter le formulaire                                   |
| Transport             | Numéro de chargement ou d’expédition                         | Identifier le dossier et ouvrir son écran associé                                                       |
| Cour / quais          | Numéro de visite ou de rendez-vous                           | Identifier le dossier et ouvrir le registre associé                                                     |
| Flotte                | Unité, VIN ou plaque véhicule; unité/plaque remorque         | Ouvrir la fiche de l’actif                                                                              |

Les écrans sans fiche individuelle ouvrent leur registre, pas une sélection automatique
d’une ligne. Les références doivent déjà être enregistrées. La lecture d’un code ne crée
pas un article et n’effectue aucune transition métier.

La recherche est exacte, tenant-scopée et limitée au type choisi. Les articles et
emplacements inactifs sont exclus. Deux correspondances sont une erreur 409, jamais
un choix arbitraire. Un code d’emplacement peut exister sur plusieurs entrepôts : les
sélecteurs de site transmettent leur contexte; le scanner global refuse l’ambiguïté.
Les zéros initiaux et la casse sont conservés. Limite : 128 caractères utiles.

## Mise en service du lecteur

### USB / Bluetooth

1. Brancher ou appairer le lecteur dans le système, en mode clavier (HID).
2. Aligner la langue du clavier du lecteur et du poste (important pour les tirets et caractères spéciaux).
3. Configurer un suffixe **Entrée** (Tab est aussi accepté).
4. Dans Pulsar, utiliser le bouton scanner de l’en-tête ou « Scanner un code-barres »
   dans un sélecteur article/emplacement. Conserver le focus dans le champ de scan.
5. Lire un code connu, vérifier son libellé, attendre la confirmation avant le prochain scan.

### Zebra Android / DataWedge

Le chemin livré est **DataWedge Keystroke Output**, qui fournit la saisie clavier au
navigateur. Il ne nécessite pas un accès WebUSB/WebHID depuis la page.

1. Dans DataWedge, créer un profil associé au navigateur qui ouvre Pulsar.
2. Activer **Barcode input** et **Keystroke output**; choisir les symbologies utilisées.
3. Ajouter **Send ENTER key** au formatage de sortie. Conserver l’émission d’Entrée
   en événement de touche, pas en chaîne. Éviter deux sorties ou deux suffixes simultanés.
4. Si les caractères arrivent dans le mauvais ordre, vérifier les délais de touches
   dans le profil; calibrer sur le terminal, pas avec un délai supposé dans Pulsar.
5. Ouvrir Pulsar par HTTPS depuis le terminal. `localhost` désigne le Zebra lui-même,
   pas le poste de développement. Le déploiement réseau/OVH n’est pas effectué dans ce lot.
6. Faire les essais ci-dessous avant utilisation opérationnelle.

Référence officielle consultée : [Zebra — Keystroke Output](https://techdocs.zebra.com/datawedge/latest/guide/output/keystroke/).
Les noms exacts des options peuvent varier selon la version DataWedge.

Le formulaire propose un clavier tactile facultatif et une saisie manuelle de secours.
Le scanner reste un champ dédié : aucune interception globale des frappes sur les autres formulaires.

## Comptages

- Mode par défaut : sélectionner l’article, puis saisir la quantité physique.
- Mode optionnel : chaque lecture confirmée ajoute **1 EA au brouillon**. Pas de +1
  pour KG/L/etc.; pas de conversion implicite entre unité, carton et palette.
- Les lignes vides restent non comptées, jamais transformées en zéro.
- Seuls les articles déjà présents dans le comptage sont acceptés. Pas d’ajout
  automatique d’une référence inconnue ou absente du snapshot.
- Une confirmation enregistre les quantités et ferme la saisie (`OPEN → COUNTED`).
  Le client envoie `expectedUpdatedAt`; mauvaises lignes et doublons sont rejetés;
  la transaction annule les écritures si la version ou le statut a changé.
- Une autre confirmation réconcilie les écarts par le registre existant
  `InventoryService.postMovement`. Aucun nouveau writer de stock.
- En cas de réponse incertaine, pas de renvoi automatique : rouvrir le dossier et
  inspecter son statut. Quitter un brouillon non enregistré demande confirmation.

La sémantique historique de réconciliation est conservée : l’écart est relatif au
snapshot système du comptage. Ce lot n’ajoute ni gel des mouvements durant comptage,
ni réservation, ni gestion des lots. Prévoir une procédure opérationnelle de contrôle
des mouvements durant les inventaires, puis un lot dédié pour les comptages à chaud.

## Tutoriels interactifs

Les 18 espaces du catalogue de navigation ont un parcours d’entrée : bureau,
transport, entrepôt, fabrication, cour, flotte, facturation, agents, analytique, CRM,
sites, portail client (administration interne), achats, documents, connecteurs,
personnalisation, courriels et réglages.

À la première ouverture d’un espace accessible à l’utilisateur :

1. Présentation de l’espace et surlignage du changement d’application.
2. Repérage des données de base, avec lien « Explorer » vers un écran autorisé.
3. Repérage des opérations, avec navigation vers un écran réel.
4. Actions contextuelles / usage du scanner lorsqu’il est disponible.
5. Connexions aux autres modules et accès à l’aide.

Le surlignage suit les éléments réels, se recalcule au redimensionnement/défilement,
et utilise des cibles de repli sur petit écran. Focus clavier contenu dans le tutoriel,
animations réduites si demandé par le système. Le parcours ne valide aucune donnée.
Une fenêtre métier déjà ouverte retarde son démarrage.

Progression versionnée dans `UserPreferences.moduleTours`, par utilisateur authentifié
(un utilisateur appartient à son tenant), avec statuts `IN_PROGRESS`, `COMPLETED`, `SKIPPED`.
La première présentation enregistre immédiatement `IN_PROGRESS`, avant tout clic. Aucun
retour/rechargement/reconnexion ni changement de version ne relance automatiquement un
guide déjà présenté, même inachevé. Aucun bandeau « Tutoriel métier » sur les accueils.
Bouton **? → Relancer le guide du module** pour recommencer volontairement, ou bouton
**Tutoriel du module** dans la barre supérieure, même sur les écrans sans en-tête standard.
Les mises à jour JSON atomiques d’un module conservent les autres modules dans les onglets
concurrents. Deux onglets du même module suivent la dernière sauvegarde reçue.
Si la sauvegarde échoue, le tutoriel reste visible et ne prétend pas être terminé.
Si la lecture des préférences échoue, la relance manuelle reste possible.

Ce sont des **visites interactives de module**, pas encore des exercices guidés avec
création d’un dossier d’entraînement et validation de chaque geste métier sur chaque page.
Les visiteurs publics et utilisateurs du portail client externe ne partagent pas ce shell;
ils n’ont pas ces tutoriels internes.

## Architecture et déploiement

- `packages/shared/src/scanning.ts` : contrats et normalisation pure.
- `core/scanning` : cinq endpoints POST de résolution en lecture seule,
  chacun protégé par son module et sa permission de lecture. Aucun audit de mutation
  ni appel d’agent puisque le scan ne modifie pas l’opération.
- `ScanInput` / `ModuleScanner` / `EntityPicker` : saisie commune et contexte.
- `ModuleTour` + `help/tours.ts` : orchestrateur unique dans le shell; contenu
  métier issu du catalogue d’aide, liens filtrés par la navigation autorisée.
- `PUT /me/preferences` accepte un `moduleTour` validé. Identité issue du JWT,
  aucun userId/tenantId accepté dans le corps.
- Migration **`20260921170000_module_tours`** à appliquer avant le démarrage de la
  nouvelle API. Elle ajoute une colonne JSONB avec défaut `{}`, sans effacer les préférences.
- Régénérer Prisma et reconstruire shared/database/API/web. Migration appliquée ici
  uniquement sur la base isolée `pulsar_enduser_20260921`; `.env` inchangé.

## Vérification

- Suites unitaires : 839 shared + 526 API + 94 web = **1 459 tests**.
- HTTP ciblés : scanners/tutoriels + lot utilisabilité = **13 tests**.
- Types : aucune erreur; 12 avertissements Svelte préexistants hors de ce lot.
- Builds API et web : réussis.
- Tests navigateur : **19 réussis**, première visite, reprise, passage, fin, relance, sauvegarde en
  échec, navigation réelle, focus/mobile, Entrée/Tab, code ambigu, picker fabrication,
  comptage +1 et confirmation sans changement de stock.

## Limites et suite

**Pas encore validé sur matériel physique.** Aucun terminal/douchette n’était connecté.
Les tests émulent la saisie clavier; ils ne certifient pas tous les modèles Zebra.

Recette terrain à faire sur une douchette USB, une Bluetooth et un Zebra Android :
code connu avec zéro initial, code inconnu, doublon, mauvais site, article inactif,
50 scans successifs avec vérification du total, langue clavier, perte/reprise réseau,
veille/reconnexion Bluetooth, rotation écran, focus après erreur et interdiction par rôle.

Prochains lots recommandés :

1. Qualification matériel et profils DataWedge documentés par modèle/version.
2. Parcours dédiés « scanner emplacement → article → quantité → confirmer » pour
   réception/préparation/rangement, avec idempotence et reprise de session explicites.
3. Étiquettes imprimables, GS1/GTIN/SSCC, lots/séries et conditionnements : cadrer les
   identifiants avant d’activer les décodeurs composites.
4. Bridge Android/Enterprise Browser pour intents, retours matériels et gestion de
   terminaux; ce lot n’installe ni APK, SDK Zebra, RFID, caméra, pilote d’imprimante,
   ni mode hors-ligne.
5. Tutoriels métier approfondis, exercices en environnement de démonstration,
   différenciation par rôle et indicateurs de progression administrateur.
