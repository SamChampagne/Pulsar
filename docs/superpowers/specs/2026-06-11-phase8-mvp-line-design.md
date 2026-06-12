# Phase 8 — Fermer la ligne MVP : BOL, modes, exceptions — design

> Validé le 2026-06-11. Ferme les trois trous restants sous la ligne MVP de
> l'[audit TMS](../../audit-tms-2026-06-10.md) : **BOL généré** (§9), **sélection de
> mode** (§4), **moteur d'exceptions simple** (§10). Après cette phase, la grille MVP
> du référentiel est cochée — la suite est de la différenciation, plus du rattrapage.

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Format BOL | **PDF serveur via `pdfkit`** (pur JS), stocké via `DocumentsService` (règle 12), séquence `BOL-` (règle 8) | Un vrai document archivé et traçable ; pas de Chromium headless pour un tabulaire simple ; la page chauffeur peut le joindre |
| Contenu BOL | Tabulaire + **blocs de signature** (expéditeur, chauffeur à la prise en charge, destinataire à la livraison avec espace réserves), **totaux** (poids, unités), mention de conditions | Un BOL sert sur papier, au quai — sans zones de signature structurées, le document est annoté anarchiquement à la main |
| Modes | Enum `TransportMode` (`FTL` défaut, `LTL`, `PARCEL`) sur ordre + load + tarif (null = tous modes), **filtre au rating** (buy + sell) | Un tarif LTL ne cote jamais un FTL — le socle de l'arbitrage. **Écart assumé vs audit §4** : c'est « le mode comme dimension », PAS l'arbitrage automatique à seuils (voir §2) |
| Exceptions | **Cron 5 min** (pattern TenderExpiry) → event `DELAYED` + `Notification` in-app (modèle dormant enfin branché) | Les fenêtres 7.2 trouvent leur premier consommateur automatique ; « détecte et réagit » (audit) sans spam courriel (préférences inexistantes) |
| Dédup des alertes | **Par `(stopId, borne dépassée)`**, pas par stop seul | Angle mort de la dédup par stop : retard → alerte → replanification → nouveau créneau dépassé à son tour → la dédup par stop avalerait précisément le second retard, le plus embarrassant. La clé inclut la borne : une fenêtre replanifiée qui passe re-alerte |

## 1. BOL généré (audit §9)

### Service

`apps/api/src/modules/transportation/bol/bol.service.ts` :

- `generate(tenantId, userId, loadId)` — exige un load **DISPATCHED ou au-delà** (un BOL
  avant dispatch n'a pas de sens ; 400 sinon). Regénération permise : chaque appel
  produit un document distinct (numéro neuf), l'historique reste.
- Assemblage (`buildBolData(load) → BolData`, fonction testable champ par champ) :
  numéro `BOL-` (séquence, règle 8), date, transporteur (nom/SCAC), chauffeur,
  équipements (tracteur/remorque), expéditeur = premier pickup (nom/adresse du site),
  destinataire = dernière delivery, lignes par shipment (numéro, ordre + référence
  client, poids, palettes), **totaux** (poids total, unités totales), notes du load.
- Rendu (`renderBol(data) → Buffer`, fonction pure pdfkit) : tabulaire + **trois blocs
  de signature** (expéditeur / chauffeur à la prise en charge / destinataire à la
  livraison avec lignes « réserves »), mention de conditions standard en pied
  (« Received in apparent good order and condition except as noted »).
- Stockage : `DocumentsService.upload` (`entityType: 'bill-of-lading'`,
  `entityId: loadId`, content-type `application/pdf`) — règle 12, jamais le FS direct.

### API & Web

- `POST /transportation/loads/:id/bol` (`transportation.execution.manage`, audité
  CREATE entityType `bill-of-lading`) → métadonnées du document créé.
- Téléchargement interne : l'endpoint Documents existant. Détail du load : section
  « Documents » listant les BOL (numéro, date, bouton télécharger).
- **Page chauffeur publique** : le payload driver expose le dernier BOL **via le jeton
  driver existant** — nouvel endpoint public `GET /public/driver/:token/bol` qui
  streame le PDF après résolution du token (JAMAIS d'id de document devinable dans le
  payload public ; règle 10 — le document contient adresses et références clients).

### Tests

Unitaire : `buildBolData` sur un load fixture (chaque champ vérifié) ; e2e : dispatch →
POST bol → 201 + document listé → download interne 200 `application/pdf` → download
chauffeur via token 200 ; avant dispatch → 400 ; token révoqué → 404.

## 2. Sélection de mode (audit §4 — partiellement)

- Enum partagé + miroir Prisma `TransportMode` (`FTL | LTL | PARCEL`).
- Colonnes : `TransportOrder.mode` (défaut FTL, saisi à la création, modifiable en
  DRAFT), `Load.mode` (défaut FTL ; **hérité du premier shipment assigné** quand le
  load est vierge, modifiable tant que OPEN/PLANNED via assign), `Rate.mode
  TransportMode?` (**null = tous modes**).
- **Branchement rating** : `rateOptions` filtre `mode IN (null, load.mode)` ;
  `rateOrder` filtre sur le mode de la commande. C'est le filtre qui rend l'arbitrage
  manuel possible.
- **Avertissement de cohérence** (non bloquant, esprit `windowWarnings`) : assigner un
  shipment dont l'ordre est d'un mode ≠ mode du load → la réponse porte un
  `modeWarning` (le mix est parfois voulu).
- **Mode suggéré** (coût quasi nul, non contraignant) : fonction pure
  `suggestMode(totalWeightKg)` dans shared (seuils constants v1 : ≤ 30 kg → PARCEL,
  ≤ 4 000 kg → LTL, sinon FTL — paramétrables plus tard), affichée comme hint dans le
  formulaire de commande. **Écart assumé vs audit §4** (à documenter) : pas de
  comparaison automatique LTL-vs-FTL à seuils — la dimension existe, l'arbitrage reste
  manuel.
- UI : sélecteur (ordre + portail) avec hint du mode suggéré, badge mode sur
  listes/détails ordre + load, colonne et champ mode sur la page Rates.
- Migration additive : 2 colonnes défaut `FTL`, 1 nullable.

## 3. Moteur d'exceptions simple (audit §10)

### Détection

`apps/api/src/modules/transportation/exceptions/delay-detection.service.ts` :

- **Cron 5 min** (même pattern que `TenderExpiryService`, méthode publique `tick()`
  appelable directement par l'e2e).
- Critère : stop d'un load `DISPATCHED`/`IN_TRANSIT`, sans `actualArrivalAt`, dont la
  borne la plus tardive connue (`plannedArrivalLate ?? plannedArrivalEarly`) est
  dépassée.
- Action (idempotente, cron-safe) : créer **un** event tracking `DELAYED`
  (message avec le retard en minutes, payload `{ stopId, deadline: <borne ISO> }`) +
  **une** `Notification` par tenant (modèle existant : title/body avec load, stop,
  retard) — **dédupliqués sur `(stopId, deadline)`** : la requête d'existence porte sur
  les events DELAYED du stop dont le payload contient la même borne. Une fenêtre
  replanifiée puis dépassée à son tour produit une NOUVELLE alerte.

### Notifications (branchement du modèle dormant)

- Vérifier au plan si un contrôleur Notifications existe ; sinon le créer :
  `GET /notifications` (paginé, non-lues d'abord, **filtré tenant**, permission
  `transportation.tracking.read`) et `POST /notifications/:id/read` — **avec
  vérification d'appartenance au tenant de la notification** (les notifications par
  tenant sans userId sortent du pattern courant : le contrôle d'appartenance est
  explicite dans le service, pas supposé).
- v1 : notifications **par tenant** (pas de ciblage utilisateur — les préférences de
  notification sont hors périmètre).

### UI

Badge cloche dans le header (compte non-lues, polling 60 s), liste déroulante
(marquer lu) ; badge « Delayed » sur le détail du load quand un event DELAYED non suivi
d'arrivée existe (la timeline existante rend déjà l'event).

### Tests

E2E : load dispatché avec `plannedArrivalLate` passée → `tick()` → event DELAYED +
notification ; second `tick()` → aucun doublon ; **replanification de la fenêtre à une
borne passée différente → nouvelle alerte** (le test de l'angle mort) ; arrivée
enregistrée → plus de nouvelle alerte pour ce stop.

## Hors périmètre (explicite)

Autres documents §9 (étiquettes, liste de colisage, douane) ; ETA prédictif ;
préférences de notification + courriel d'alerte ; règles d'exception paramétrables
(moteur générique = différenciateur 19.2) ; arbitrage automatique LTL/FTL à seuils
(audit §4 — l'écart est assumé et documenté) ; re-rating automatique sur changement de
mode ; taxes (rappel : premier ajout post-7.3 si facturation réelle).
