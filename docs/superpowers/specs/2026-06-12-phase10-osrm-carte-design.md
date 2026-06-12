# Phase 10 — Moteur carto OSRM + carte opérationnelle (design)

> Validé au brainstorming du 2026-06-12 (Sam). Périmètre décidé en fin de phase 9 :
> distances/temps automatiques via OSRM (audit §7 « intégrer, ne pas écrire »),
> carte live sur le dashboard, et levée de la décision différée sur l'exposition
> des coordonnées dans le suivi public.

## Objectifs

1. **Distances/temps automatiques** sur les routes (fiabilise PER_KM et le rate shopping).
2. **Géocodage automatique** des locations sans coordonnées (préalable au point 1).
3. **Positions chauffeur** : la page chauffeur publique alimente enfin `POSITION_UPDATE`.
4. **Carte opérationnelle live** sur le dashboard interne (loads actifs, retards en rouge).
5. **Carte publique de suivi** : décision prise — on expose la dernière position seulement.

Hors périmètre : optimisation de tournée (VRP/OR-Tools), re-géocodage en masse des
locations existantes, app chauffeur native, websockets.

## A. Moteur carto backend

### Contrat et drivers

`apps/api/src/core/routing/` expose un `RoutingService` derrière le pattern driver
existant (`EMAIL_DRIVER`/`FILE_STORAGE`) :

- `route(points: {lat, lng}[]) → { distanceKm, durationMin, geometry } | null`
- `geocode(address: string) → { lat, lng } | null`

Variables d'env (toutes dans `.env.example`) :

| Variable | Valeurs | Défaut |
| -------- | ------- | ------ |
| `ROUTING_DRIVER` | `osrm` \| `none` | `none` |
| `OSRM_HOST` | URL du serveur OSRM | — |
| `GEOCODING_DRIVER` | `nominatim` \| `none` | `none` |
| `NOMINATIM_HOST` | URL du serveur Nominatim | `https://nominatim.openstreetmap.org` |

Contraintes d'appel :

- **Timeout court (3 s)** sur chaque appel HTTP ; échec → `null` + log warn,
  **jamais bloquant** pour le flux appelant.
- **Nominatim** : throttle **1 req/s** (file séquentielle in-process — valable tant
  que l'API est mono-instance ; à revoir avec le passage à Redis du cache modules
  le jour où ça scale, surtout sur le Nominatim public) et **User-Agent custom**
  identifiant l'application (conformité usage léger).
- OSRM appelé en `GET /route/v1/driving/{lng,lat;…}?overview=simplified&geometries=geojson`
  (géométrie simplifiée : visuellement quasi identique, beaucoup plus légère à stocker).

### Cache géocodage persisté

Table `geocode_cache` (globale, **sans `tenantId`** — une adresse → des coordonnées
n'est pas une donnée tenant) : `addressKey` (adresse normalisée, unique), `latitude`,
`longitude`, `provider`, `createdAt`. Toute résolution passe par le cache avant
d'appeler Nominatim ; un échec de géocodage n'est **pas** mis en cache.

### Distances auto au build de route

Dans `RoutesService.createForLoad` :

- Si `dto.totalDistanceKm` est **fourni** → valeur manuelle, `distanceSource = MANUAL`,
  jamais écrasée par un recalcul ultérieur. **La géométrie est quand même calculée**
  si les coordonnées sont là (OSRM appelé pour `geometry` seul) : la distance
  manuelle reste l'invariant billing, mais la carte détail reste vraie.
- Sinon, si toutes les stops ont des coordonnées → appel OSRM :
  `totalDistanceKm` + `estimatedDurationMin` + `geometry` remplis,
  `distanceSource = OSRM`.
- Si OSRM indisponible (driver `none`, timeout, erreur) mais coordonnées présentes →
  **fallback haversine** (somme des segments à vol d'oiseau, durée laissée nulle),
  `distanceSource = HAVERSINE`. Un build ultérieur avec OSRM disponible recalcule.
  ⚠ Le vol d'oiseau sous-estime la route réelle (-20 à -30 %) : l'UI **doit**
  afficher `distanceSource` (badge « estimation » sur HAVERSINE) pour que le
  dispatch corrige à la main — un facteur correctif est un choix produit différé.
- Sans coordonnées complètes → distance nulle, comportement actuel inchangé.

`LoadCostService.recompute()` reste appelé après le build (chemin existant — règle 11) ;
l'invariant `costDetail` figé sur COMPLETED (règle 16) n'est pas touché.

### Géocodage des locations

`LocationsService.create/update` : si lat/lng absents du payload, géocodage
best-effort (cache → Nominatim). La saisie manuelle prime ; un échec sauve la
location sans coordonnées. Les locations existantes se géocodent à leur prochaine
édition (pas de batch en phase 10).

### Migration 17 (sans appel réseau, colonnes nullables)

- `Route.geometry Json?` (GeoJSON LineString OSRM) ;
- `Route.distanceSource DistanceSource?` — enum `MANUAL | OSRM | HAVERSINE`,
  déclarée dans `@pulsar/shared` et miroir Prisma (règle 3) ;
- table `geocode_cache`.

Aucun backfill réseau : les routes existantes restent `distanceSource = null`
(sémantique : valeur historique saisie à la main).

## B. Positions chauffeur + suivi public

### Endpoint public de position

`POST /api/v1/public/driver/:token/position` `{ latitude, longitude }` :

- token driver résolu comme les routes publiques existantes ; **re-check
  d'activation du module** dans le service (règle 15) ;
- **bornes validées au DTO** (`latitude ∈ [-90, 90]`, `longitude ∈ [-180, 180]`) —
  c'est de l'input anonyme, on rejette les (9999, 9999) à la porte ;
- accepté seulement si le load est `DISPATCHED` ou `IN_TRANSIT` ;
- crée un `TrackingEvent` `POSITION_UPDATE` (lat/lng, `recordedById` absent) ;
- **dédoublonnage serveur** : ignoré (204) si la dernière position du load date de
  moins de 60 s ; throttling IP (throttler Nest existant).

### Page chauffeur (web)

Après le prompt de consentement géoloc du navigateur : envoi d'une position toutes
les ~2 min tant que la page est visible et le load actif, **plus un envoi immédiat
au chargement de la page et à chaque `visibilitychange` → visible** (chaque
consultation du chauffeur donne un point frais). Indicateur discret « partage de
position actif » avec bouton pour couper. Page fermée ou écran verrouillé = plus
de pings : couverture trouée assumée, pas d'app native en phase 10.

### Payload public de suivi (décision levée)

`GET /public/track/:token` ajoute, en projection explicite (règle 10 — aucun id
interne, aucun `tenantId`) :

- `lastPosition: { latitude, longitude, occurredAt } | null` — dernier
  `POSITION_UPDATE` du load porteur, exposé **seulement tant que le shipment
  n'est pas livré** ;
- `origin.latitude/longitude` et `destination.latitude/longitude` (l'adresse
  concernée appartient au client qui consulte son propre envoi).

**Rien d'autre** : pas d'historique de positions, pas des autres stops de la
tournée (un load multi-clients ne fuit pas son itinéraire).

La page `track/[token]` affiche une petite carte Leaflet (origine, destination,
dernière position), masquée gracieusement si aucune coordonnée.

## C. Carte opérationnelle dashboard (interne)

### Endpoint agrégé

`GET /api/v1/transportation/loads/active-map` — permission existante
`transportation.loads.read`, **aucune nouvelle clé de permission**. Retourne les
loads `DISPATCHED`/`IN_TRANSIT` du tenant avec :

- `loadNumber`, `status`, transporteur ;
- stops ordonnés (séquence, type, statut, ville, lat/lng) ;
- dernière position (`POSITION_UPDATE` le plus récent) ;
- `isLate: boolean` — calculé avec **la même fonction pure `isLate`** que le moteur
  d'exceptions de la phase 8 (aucune logique de retard dupliquée).

**Pas de `geometry` dans ce payload** : OpsMap n'affiche que des marqueurs, et des
géométries de centaines de km re-téléchargées toutes les 45 s pour tous les loads
actifs seraient du poids mort. La géométrie reste réservée au détail (`LoadMap`).

### Composant `OpsMap.svelte`

Généralisation du germe `LoadMap` (phase 9), affiché en tête du dashboard :

- un marqueur par load — dernière position si connue, sinon prochain stop à venir ;
- **rouge si `isLate`**, couleur brand sinon ; tooltip (load, transporteur, statut)
  et clic → page détail du load ;
- polling toutes les **45 s** uniquement quand l'onglet est visible
  (`document.visibilityState`) ;
- état vide géré (aucun load actif → carte remplacée par un empty state).

### Détail load

`LoadMap` trace la **géométrie OSRM réelle** (`Route.geometry`) quand elle existe,
au lieu de la ligne droite pointillée actuelle (qui reste le fallback).

⚠ Ordre des coordonnées : le GeoJSON OSRM est en `[lng, lat]`, Leaflet attend du
`[lat, lng]`. Le tracé passe par **`L.geoJSON`** (qui gère l'ordre nativement) —
jamais de coords GeoJSON brutes dans `L.polyline`, sinon la route se dessine dans
l'océan. La suite e2e OSRM réelle vérifie les **bornes de la géométrie** d'un
trajet connu pour attraper toute inversion.

L'éditeur de route et le détail affichent la provenance de la distance
(`distanceSource`) : badge « estimation » sur HAVERSINE (cf. section A).

## D. Dégradation, erreurs, tests

### Dégradation

- OSRM/Nominatim down → comportement pré-phase-10 (distance manuelle, pas de
  géométrie, location sans coords). Pas de file de retry : le calcul se rejoue
  naturellement au prochain build de route / édition de location.
- CI et e2e tournent en drivers `none` → **zéro dépendance réseau**.

### Dev local

`docker-compose` gagne un service `osrm/osrm-backend` (profil optionnel pour ne pas
alourdir `pnpm db:up`). La préparation de l'extrait OSM (Québec, Geofabrik :
`osrm-extract` → `osrm-partition` → `osrm-customize`) est documentée dans
`docs/getting-started.md` avec un script d'amorçage.

### Tests

- **Unit** : clients OSRM/Nominatim mockés (parsing réponse, timeout → null),
  haversine, normalisation de clé du cache géocodage.
- **e2e (driver `none`)** : endpoint position (création d'événement, dédoublonnage
  60 s, 404 token inconnu, 4xx module désactivé, 4xx load non actif, **400 sur
  bornes lat/lng invalides**) ; payload
  public avec `lastPosition` (et son absence après livraison) ; `active-map`
  (isolation tenant, permission, flag `isLate`) ; build de route sans coordonnées
  = comportement inchangé.
- **e2e optionnelle OSRM réel** : suite skippée si `OSRM_HOST` absent — vérifie
  distance/durée/géométrie sur un trajet connu, **bornes lat/lng de la géométrie
  incluses** (détecte une inversion `[lng, lat]`/`[lat, lng]`).

## Récap des décisions de cadrage

| Question | Décision |
| -------- | -------- |
| Hébergement OSRM | Auto-hébergé docker + `OSRM_HOST` configurable (pattern Fleetbase) |
| Géocodage | Nominatim auto best-effort + cache BD + throttle 1 req/s + UA custom |
| Positions chauffeur | Pings auto ~2 min depuis la page chauffeur (consentement navigateur) |
| Coordonnées publiques | Oui — dernière position seulement + origine/destination du shipment |
| Rafraîchissement carte | Polling 45 s, onglet visible seulement |
| Intégration API | Service synchrone best-effort derrière contrat driver, fallback haversine |
