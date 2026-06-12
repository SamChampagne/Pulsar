# Phase 9 — Refonte UI du SPA (design)

> Spec validée en brainstorming le 2026-06-12 (maquettes : `.superpowers/brainstorm/`,
> non versionnées). Verdict produit d'origine : UI actuelle « fonctionnelle mais pas
> vendable » (test manuel fin de phase 8). Références UX issues du benchmark Fleetbase
> (voir mémoire de session + `docs/etat-du-projet.md`).

## Objectif

Rendre l'interface vendable : démontrable à un client, utilisable en continu par un
dispatcher, cohérente sur les 28 pages (app interne, pages publiques, plan plateforme).

## Contraintes dures

- **Aucun changement de contrat API.** Le chantier est purement front
  (`apps/web` + dépendances npm front uniquement).
- **Les 249 tests restent verts** (`pnpm test`, `pnpm test:e2e`) ; garde-fous front :
  `pnpm typecheck` + build web.
- Pages publiques : aucune donnée interne supplémentaire exposée (règle n°10 inchangée).

## Décisions de design (validées une à une)

| Sujet | Décision |
|---|---|
| Direction visuelle | **Console hybride** : sidebar sombre (`#0f172a`), contenu clair, panneau de détail latéral (réf. Fleetbase/Samsara) |
| Périmètre | **Toutes les pages** : app interne (18) + publiques (tender/track/driver/portal) + login/reset + plan plateforme |
| Navigation | Sidebar à **groupes repliables** (seul le groupe actif déployé) : Opérations, Tarification, Partenaires, Facturation, Analytics, Réglages — conditionnés aux modules actifs du tenant comme aujourd'hui |
| Densité des tableaux | **Commutable** : confortable par défaut, toggle compact persisté par utilisateur (localStorage) |
| Carte | **Leaflet + tuiles OSM, lecture seule** : mini-carte sur le panneau/détail load (stops numérotés + dernière position issue des tracking events) et carte sur la page de suivi public. Pas de carte dashboard cette phase |
| IA | **Coquille seulement** : command palette ⌘K (navigation + recherche d'entités, sans IA) avec slot assistant désactivé — le backend IA se branchera en phase 11 sans retoucher l'UI |
| Dark mode | **Tokens prêts, thème plus tard** : toutes les couleurs en variables CSS, seul le thème clair est livré |
| Stack | **Tailwind CSS 4** + tokens variables CSS + composants maison, icônes **Lucide**, police **Inter**, **Leaflet** pour les cartes. Pas de librairie de composants tierce |

## Architecture front

### Design system — `apps/web/src/lib/components/ui/`

Tokens dans un fichier CSS racine (`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`) ;
Tailwind configuré pour les consommer. Composants partagés (~15) :

- **Button** (primaire/secondaire/danger/ghost, états loading)
- **Badge** — statuts des 3 machines à états + modes (mapping centralisé statut→couleur)
- **Table** — tri, densité commutable, sélection de ligne, état vide, skeleton de chargement
- **FilterBar** — pills de filtres actifs + dropdowns
- **Panel** — slide-over latéral (aperçu d'une ligne sans quitter la liste)
- **Modal**, **Tabs**, **Card**, **PageHeader**, **EmptyState**, **Skeleton**
- **Form** : Input, Select, DatePicker, Textarea (validation visuelle homogène)
- **CommandPalette** (⌘K) — navigation + recherche, slot assistant désactivé
- **Toasts** (refonte de l'existant), **StatusBadge** et **TrackingTimeline** migrés

### Layout

- `(app)/+layout.svelte` : sidebar sombre repliable, recherche ⌘K en tête, cloche
  notifications + menu utilisateur en pied de sidebar. Logique modules/auth inchangée.
- Variante **page publique** : header simple sans sidebar, même tokens.
- Plan plateforme : même design system + badge « Platform admin » distinctif.

### Pattern liste + panneau

Les pages liste conservent URL et appels API actuels. Clic sur une ligne → Panel latéral
(aperçu + actions rapides) ; « Ouvrir ↗ » → page détail complète. Pages détail
(loads/[id], transport-orders/[id]) refondues avec le même système.

### Carte (lecture seule)

Composant `LoadMap` : stops numérotés (lat/long des locations), tracé polyline naïf
(droites entre stops — le tracé routier réel arrive avec OSRM en phase 10), dernière
position connue (tracking events POSITION_UPDATE). Utilisé sur le détail load et la
page de suivi public. Dégradé propre si lat/long absents (carte masquée).

## Ordre d'exécution

1. Socle : Tailwind, tokens, composants ui/, nouveau layout + sidebar + ⌘K
2. Lot Opérations : transport-orders (+détail), shipments, loads (+détail, mini-carte)
3. Lot Tarification : lanes, rates, accessorials, fuel-tables
4. Lot Partenaires/Facturation/Analytics : customers, carriers, invoices, analytics, dashboard
5. Lot Réglages : users, api-keys, modules, sso
6. Lot Public : login/reset, tender, track (+carte), driver (mobile-first), portal
7. Lot Plateforme : platform/login, platform/tenants

Chaque lot est vérifiable visuellement et laisse l'app fonctionnelle (les anciennes
pages cohabitent avec les nouvelles pendant la migration).

## Vérification

- `pnpm typecheck` + `pnpm build` verts à chaque lot
- `pnpm test` + `pnpm test:e2e` verts en fin de phase (aucun contrat touché)
- Test manuel par lot : parcours guide-fonctionnel.md sur les pages migrées
- Le skill `frontend-design` est utilisé à l'implémentation

## Hors périmètre — phases suivantes (décidé au brainstorming)

- **Phase 10** : moteur carto OSRM (backend : distances/temps auto, fiabilise PER_KM)
  + carte opérationnelle live sur le dashboard (loads actifs, positions, retards) —
  la « live map » complète a besoin d'OSRM pour les tracés et ETA.
- **Phase 11** : différenciateurs IA — agent opérationnel (file « actions proposées »,
  pattern commit/discard), ingestion de grilles tarifaires, extraction de factures PDF.
  L'UI de la phase 9 lui réserve la palette ⌘K.
- **Plus tard** : éditeur graphique de workflows (paramétrage avant code), optimisation
  VROOM, zones en polygones, thème sombre complet.
- L'option « pilote client » (taxes sell-side, smoke S3, durcissement) reste
  intercalable entre ces phases.
