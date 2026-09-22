# Utilisabilité opérationnelle — lot 1 (2026-09-21)

Branche : `codex/end-user-workflows`, créée depuis `access-module-core-locations`.
Travail local, sans push ni PR. Aucun changement de schéma ni migration dans ce lot.
Le socle du 17 septembre est conservé : pickers, portail v2, connecteurs, lieux partagés.
Les anciens lots MRP présents dans d’autres branches ne sont pas réintroduits.

## Diagnostic

Plusieurs fonctionnalités existaient côté API mais n’étaient pas exposées dans les écrans
clients/transporteurs. Les formulaires avaient peu de validation, la page Clients appelait
un GET branding inexistant et masquait son erreur. Certaines cartes Leaflet étaient
initialisées alors que leur conteneur était encore caché. L’aide métier était dispersée
ou absente. L’objectif est de compléter les parcours existants, pas de remplacer le design.

## Demandes et couverture effective

| Demande                           | Livré dans ce lot                                                                                                                               | Limite / suite                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Modifier clients et transporteurs | Bouton sur listes et fiches, coordonnées, activation/désactivation confirmée, conservation de l’historique                                      | Code fixe; pas de suppression; pas de révocation automatique des accès portail ni d’annulation d’opérations  |
| Champs qualifiés                  | Téléphone 7–15 chiffres avec format international/extension; longueurs, courriels, SCAC, coordonnées; contrôles serveur et UI                   | Pas de vérification de l’existence réelle du numéro                                                          |
| Ville/province/code postal        | Villes déjà utilisées par le tenant, provinces/pays du référentiel existant, postal CA/US et borne générique                                    | Ce n’est pas une base mondiale d’adresses; une nouvelle ville peut être saisie librement                     |
| Dates faciles                     | Sélecteurs natifs existants préservés                                                                                                           | Raccourcis Aujourd’hui/Demain, calendrier partagé et fenêtres horaires restent à faire                       |
| Aide par page                     | Icône dans PageHeader/RecordHeader; 8 guides précis et guide de repli pour les 18 domaines du catalogue                                         | Les écrans sans ces headers ne reçoivent pas automatiquement l’icône; enrichir les textes page par page      |
| Tutoriel module                   | Guide textuel en étapes, option Découvrir au premier accueil, relançable; état par tenant/utilisateur/navigateur                                | Pas de surlignage des contrôles, pas de synchronisation serveur ni déclenchement lors de l’activation tenant |
| Voies/corridors                   | Aide détaillée et titre « Liaisons · corridors »; retrait de la longue explication inline                                                       | Création déjà existante via Nouveau corridor; aucun nouvel algorithme de matching                            |
| Modifier un load                  | Notes versionnées pour OPEN/PLANNED, liens vers ressources/tournée/expéditions; affectation de ressources protégée contre changement concurrent | Pas de réécriture des chargements exécutés; pas de réouverture ni d’effacement arbitraire des ressources     |
| Cartes                            | Initialisation après affichage; recalage au redimensionnement dans les 4 composants; labels sûrs; états explicites du LoadMap                   | Une carte ne crée pas de coordonnées; géocodage/routage et tuiles externes restent des dépendances           |
| Entrée → suivant                  | Action opt-in sur formulaires clients, transporteurs, lieux et créations rapides article/bin; Maj+Entrée précédent                              | Pas global : préserve textarea, combobox, datalist, IME et activation des boutons                            |
| Création de destination inline    | « + » dans le sélecteur destination d’un déplacement de stock; bin du même site, sélection après création                                       | Aucun MOVE automatique; confirmation existante conservée                                                     |
| Zones plus accessibles            | Colonne et champ Zone dans Emplacements, édition versionnée et entrepôt verrouillé                                                              | La zone reste Bin.zone; pas de zone vide/autonome ou création en série                                       |
| Articles depuis Fabrication       | Création d’article depuis produit/matière d’une nomenclature et produit d’un ordre                                                              | Nécessite WMS activé + wms.manage; un article créé n’a aucun stock                                           |
| Bureau côte à côte                | Non livré                                                                                                                                       | Conception d’un espace à deux panneaux, pas une simple duplication d’iframes                                 |
| Scanners / codes-barres           | Champ code-barres dans création rapide; saisie scanner non livrée                                                                               | Parcours scan de comptage à développer sur les writers existants                                             |
| Apparence                         | Entrée retirée de Réglages, lien du bureau vers Personnalisation, ancienne URL redirigée                                                        | Personnalisation existante conservée                                                                         |
| Logo depuis ordinateur            | PNG/JPEG/WebP jusqu’à 2 Mo, aperçu, import persisté via DocumentsService, GET branding corrigé                                                  | URL publique par capacité; anciens fichiers conservés mais URL révoquée si remplacée                         |

## Contrats de sécurité et données

- Réutilisation des permissions et contrôleurs existants; aucune permission élargie.
- Validations en DTO/service, pas seulement HTML. PATCH ne peut pas rendre null un champ requis;
  les champs facultatifs comme courriel/téléphone peuvent être effacés.
- Activation transporteur via `canTransitionCarrier` partagé et écriture conditionnelle sur
  l’état relu; audit via l’intercepteur master-data existant.
- Notes du load : `expectedUpdatedAt` obligatoire, tenant + statut + version dans l’écriture;
  conflit 409. Aucun changement de coût, stock ou statut dans ce PATCH.
- Édition bin : transmet `expectedUpdatedAt`, réutilise le writer WMS existant.
  Zone = classement d’affichage, jamais mouvement ou réservation.
- Import du logo : signature de format contrôlée, pas de SVG, taille plafonnée; stockage et
  téléchargement par DocumentsService. Ce contrôle n’est pas un décodage/réencodage d’image.
- Logo public : token aléatoire 24 octets, vérification module activé et URL encore courante,
  `nosniff`, pas de tenantId ni d’identifiant Document dans l’URL.
- Un chargement de fiche/branding en échec bloque la sauvegarde plutôt que d’écraser les données
  avec un formulaire vide. Les valeurs saisies restent visibles sur une erreur de validation.
- Les marqueurs cartographiques utilisent du texte DOM, pas du HTML provenant des noms de lieux.

## Vérifications

Exécutées localement le 21 septembre sur une base dédiée `pulsar_enduser_20260921`,
migrée et seedée; aucun reset de la base de travail habituelle et aucun changement de `.env`.
Email en mode log, géocodage/routage désactivés pour les tests HTTP déterministes.

- Build complet : PASS.
- Typecheck workspaces : 0 erreur; 12 avertissements Svelte préexistants dans 5 fichiers.
- Unit shared : 829 tests / 88 fichiers.
- Unit API : 513 tests / 79 suites.
- Unit web : 90 tests / 11 fichiers.
- HTTP ciblés : 24 tests / 3 suites (`end-user-workflows`, `workflow`, `phase3`).
  Jest nécessite `--forceExit` à cause de handles applicatifs résiduels; les assertions passent.
- Playwright ciblé : 12 scénarios Chromium, APIs contrôlées : édition/désactivation, téléphone,
  droits UI, clavier, aide, redirection, logo, création article, échec de lecture, villes,
  version bin et carte après redimensionnement. Les tuiles du test carte sont contrôlées.
- Contrôle visuel manuel sur l’API réelle : liste/modal Clients, aide Clients, tableau de bord
  et fond de carte OpenStreetMap. Ce contrôle ne certifie pas un itinéraire OSRM réel.
- Les tests EDI existants normalisent maintenant les fixtures avant de construire leurs variantes
  LF/CRLF : correction de portabilité Windows, parseur de production inchangé.

Ce n’est pas une exécution de toutes les suites HTTP ni une recette de chaque module de Pulsar.

## Suite proposée, dans l’ordre

1. **Zones et emplacements comme vrais référentiels.** Zone tenant/site-scopée pouvant exister
   vide, nom/code uniques par site, archivage, affectation multiple d’emplacements et plan visuel.
   Migration explicite de Bin.zone; conserver l’absence d’effets stock et les verrous WMS.
2. **Saisie opérationnelle commune.** Calendrier partagé avec raccourcis et fuseau explicite,
   validation cohérente, création inline dans tous les pickers pertinents, recherche d’adresses
   via fournisseur choisi, cache et limites. Ne pas brancher un service public d’autocomplete
   sans examiner ses conditions, quotas et la confidentialité des adresses.
3. **Tutoriels réellement guidés.** Étapes ciblées par data-guide, progression serveur par
   utilisateur/tenant/version, ignorer les étapes sans permission, relancer depuis l’aide,
   clavier/lecteur d’écran/reduced-motion et interruption sans perte de saisie.
4. **Comptage au scanner.** Mode douchette USB/Bluetooth avec suffixe Entrée : emplacement →
   article → quantité, feedback de doublon/erreur, confirmation avant ajustement. L’action
   enterNext devra être exclue de cette surface. Tester sur matériel réel avant mode hors-ligne.
5. **Deux modules côte à côte.** Navigation et contexte séparés par panneau, redimensionnement,
   raccourcis et retour aux dossiers; drafts conservés et prévention d’un double envoi. Garder
   le bureau d’applications actuel.

Autres améliorations proposées : filtre Actifs/Inactifs dans les référentiels, centralisation
du branding dans le Portail tout en gardant le raccourci Transport, diagnostics cartographiques
(coordonnées manquantes / fournisseur indisponible), audit d’usage des partenaires inactifs,
versions optimistes clients/transporteurs, nettoyage contrôlé des anciens logos et fusion
atomique des réglages de branding pour les éditions concurrentes.
