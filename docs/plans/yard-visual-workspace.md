# Cour & quais — poste de travail visuel

Date : 2026-09-14. Branche : `codex/yard-visual-workspace`, depuis `6890055`.

## Direction produit

Priorité choisie : approfondir les modules existants avec des interfaces adaptées
au métier, plutôt que poursuivre seulement l’uniformisation des listes. Le bureau
d’applications reste inchangé. Ce premier lot concerne `/yard`, pas l’ensemble des
modules ni tous les processus d’entrepôt.

La revue de refonte conserve Svelte, Tailwind, les tokens et les composants communs.
Elle introduit une représentation du site, des remorques et du temps là où cela aide
à travailler. Les panneaux animés préservent la largeur du plan; les actions restent
accessibles sans glisser-déposer.

## Livré

- Sélection du site, compteurs et visites du même site. Les sites possédant des
  emplacements remontent en premier. Un utilisateur disposant seulement du module
  Yard et de ses permissions peut consulter le poste de travail.
- Plan : quais, stationnements et zones de préparation; état libre, occupé,
  inactif ou conflit historique. Les remorques sont représentées visuellement.
  Zoom et défilement internes, recherche et filtres des visites.
- Dessin configurable par site : bâtiments, zones et accès; positions des
  emplacements existants. Édition par glisser-déposer ou coordonnées au clavier,
  proposition de disposition à confirmer, sauvegarde et abandon explicites.
- Planning des quais sur une journée dans le fuseau IANA du site (23/24/25 heures).
  Les rendez-vous chevauchant minuit sont inclus. Chevauchements signalés, sans
  résolution automatique. Les réservations historiques sur d’autres types
  d’emplacement restent visibles.
- Panneau de visite : véhicule, transporteur, chauffeur, arrivée, temps de présence,
  rendez-vous lié et déplacements. Affectation/déplacement et départ confirmés.
- Arrivée rapide, avec ou sans rendez-vous, champs personnalisés Yard et affectation
  immédiate optionnelle. Une réponse de validation conserve la saisie; une réponse
  réseau/serveur incertaine bloque sa répétition et demande de vérifier les visites.
- Lecture actualisée toutes les 30 secondes lorsque l’onglet est visible, suspendue
  durant l’édition ou les panneaux. Réponses obsolètes ignorées au changement de site.
  Données non actualisées ou tronquées signalées; mutations du poste de travail
  désactivées tant que cette situation persiste.

## Contrats techniques

### Préparer le premier site

La base de développement actuelle n’a pas d’emplacements Yard. Aucune fausse
occupation n’a été ajoutée pour embellir le résultat. Ouvrir `/yard`, choisir le site,
puis **Gérer les quais et emplacements** pour créer ses quais/stationnements.
Revenir au plan, choisir **Configurer le plan**, placer les emplacements ou utiliser
**Proposer une disposition**, puis enregistrer. Les arrivées alimentent ensuite
l’occupation. Le fuseau doit être renseigné sur la fiche du site; sans fuseau,
le poste de travail annonce explicitement le repli UTC.

### API et persistance

| Route | Droit | Contrat |
| --- | --- | --- |
| `GET /yard/sites` | `yard.read` | Sites actifs du tenant, maximum 500, indicateur de troncature |
| `GET /yard/workspace?locationId&date` | `yard.read` | Plan, visites actives et rendez-vous de la journée locale; projections limitées |
| `PUT /yard/sites/:id/plan` | `yard.manage` | `expectedVersion`, `shapes`, positions de tous les emplacements du site |

Ces routes utilisent le préfixe habituel `/api/v1` et exigent le module Yard actif.
Le tenant vient exclusivement du JWT. Les services métier existants restent
l’unique chemin des opérations; aucun nouveau statut ni outil agent n’est ajouté.

Migration additive `20260914200000_yard_visual_workspace` : colonne nullable
`locations.yardPlan` JSONB. Les coordonnées `YardSpot.posX/posY` restent inchangées.
La migration a été appliquée aux bases locales de développement et de test.

Le dessin n’est ni une carte géographique ni un calcul de capacité : grille
64 × 64, jusqu’à 40 rectangles et 500 emplacements. Les coordonnées sont
**strictement d’affichage**. Retirer un emplacement du dessin ne le supprime pas.
L’occupation est toujours dérivée des visites actives.

La sauvegarde verrouille le site et contrôle une version dérivée de la géométrie.
Une sauvegarde concurrente obsolète reçoit 409, sans écraser l’autre version. Les
créations/modifications d’emplacements et l’ancien endpoint de disposition
participent au verrouillage; ce dernier reste compatible et est désormais audité.

## Durcissement des opérations

- Affectation uniquement vers un emplacement actif du même site et du même tenant.
- Sérialisation par site des affectations, déplacements, départs, annulations et
  transitions de rendez-vous; transitions conditionnelles via les state machines.
- Un emplacement occupé refuse une autre visite avec 409, **même si un ancien
  réglage `spotConflictPolicy=WARN` est enregistré**. Ce changement respecte la
  règle 34 d’AGENTS.md; le réglage historique est conservé mais clairement libellé
  comme obsolète. Aucune configuration de tenant n’est réécrite automatiquement.
- Répéter un déplacement vers le même emplacement ne crée pas de nouveau mouvement.
  Départ et annulation libèrent l’emplacement et enregistrent un `YardMove` dans
  la transaction. Une visite partie ne peut pas être réaffectée.
- Une arrivée liée doit correspondre au site et à un rendez-vous ouvert. Une visite
  non annulée déjà liée interdit une deuxième arrivée pour ce rendez-vous.
- Un emplacement occupé ne peut être désactivé; changer son site nécessite de créer
  un nouvel emplacement. Les nouveaux rendez-vous ne ciblent qu’un quai actif du site.

## Vérification

- Shared Yard : 27 tests (transitions, présence, fuseaux et chevauchements),
  plus 25 tests de configuration/champs personnalisés.
- API Yard : 9 tests unitaires et 57 tests HTTP sur 4 suites, base dédiée.
- Web : 34 tests unitaires.
- Svelte : 0 erreur, 12 avertissements préexistants hors des nouveaux composants.
- Builds API et SPA de production réussis.
- Régression finale : **139 tests UI passent (2,2 min, 2 workers)**, dont 15 scénarios
  Yard : plan et occupation, confirmations, échecs, saisie préservée, réponse
  incertaine sans répétition, sauvegarde/rechargement du dessin, réservation
  historique, lecture seule, réponses tardives, données tronquées, site vide et
  emplacement inactif. Les autres scénarios couvrent les lots précédents de
  finance, CRM, préparation d’expéditions et navigation.
- Captures bureau, téléphone (390 px), planning et site vide inspectées. Le plan
  et la timeline ont leur propre défilement, sans élargir la navigation.

Les suites HTTP passent mais Jest signale encore des handles asynchrones ouverts
à la fermeture (dette de test existante); les processus finissent avec le code 0.
Cette campagne ne constitue pas une validation exhaustive de tous les modules
ni un test de charge ou de déploiement OVH.

Les scénarios navigateur utilisent une vraie connexion à l’application, des
réponses Yard contrôlées et des mutations simulées. Les tests HTTP exécutent les
mutations réelles sur leurs propres données en base de test, pas sur la cour de
développement. Aucun courriel, SMS ou appel de connecteur externe n’est déclenché.

Commandes principales :

```sh
pnpm --filter @pulsar/shared build
pnpm --filter @pulsar/shared test -- src/yard
pnpm --filter @pulsar/api test --runInBand visits.service.spec.ts spots.service.spec.ts appointments.service.spec.ts
pnpm --filter @pulsar/api test:e2e yard-workspace.e2e-spec.ts yard-plan.e2e-spec.ts yard-module.e2e-spec.ts configurable-wms-yard-fleet.e2e-spec.ts
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test:e2e yard-workspace.spec.ts --workers=2 --reporter=line
```

Régression navigateur consolidée :

```sh
pnpm --filter @pulsar/web test:e2e yard-workspace.spec.ts bank-csv-import.spec.ts finance-connected-flow.spec.ts finance-audit.spec.ts billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```

Pour les tests HTTP, fournir `DATABASE_URL` vers la base dédiée et
`EMAIL_DRIVER=log`. Pour le navigateur, API locale sur 3100 et Vite sur 5173.

## Limites et prochain lot

1. **Lier les dossiers réels** : rendez-vous/visite ↔ chargement TMS ↔ réception ou
   préparation WMS. Concevoir les FK, permissions, projections et événements sans
   terminer implicitement un chargement lors du départ de la cour.
2. **Planification approfondie** : création/replanification contextuelle dans le
   planning, durée d’opération, horaires/capacité par quai et compatibilité des
   ressources. La création détaillée demeure sur `/yard/appointments`; ce lot
   n’ajoute pas un moteur de réservation ou d’optimisation automatique.
3. **Personnalisation métier** : seuils de présence par site/type d’opération,
   catégories et profils d’affichage. Le seuil de détention présenté utilise
   actuellement le helper existant (120 minutes), pas un SLA contractuel configurable.
4. **Agents** : proposer les affectations et traiter les retards à partir des
   événements et outils gouvernés existants. Aucun déplacement autonome, envoi
   externe ou contournement de la file `ProposedAction` dans ce lot.
5. **Échelle et résilience** : pagination/recherche de sites au-delà de 500,
   virtualisation de très grands plans/plannings, brouillon persistant et
   idempotence serveur des arrivées sans rendez-vous. Le brouillon actuel reste
   en mémoire; une fermeture/recharge volontaire peut le perdre.

Le plan sauvegardé est commun aux opérateurs du site, pas une préférence personnelle.
Pas de promesse de temps réel instantané, de fonctionnement hors ligne ou de
compatibilité universelle avec tous les métiers. Les écrans historiques Gate,
Emplacements et Rendez-vous restent à approfondir.

Prochaine application après ce socle : **WMS**, avec représentation des zones/bins,
progression visuelle réception → rangement → préparation et liens opérationnels
vers les quais. Puis Flotte (disponibilité/maintenance) et Fabrication (postes/flux).

Aucun push GitHub ni déploiement OVH dans ce lot. Aucun changement du `.env`.
