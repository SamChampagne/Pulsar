# Pulsar — Directive de redesign des pages (warm identity)

> Mandat de Sam : sortir Pulsar du « pages blanches de formulaires / tableaux mal foutus » vers de vrais
> **espaces de travail**. Identité chaude **déjà en place** dans `app.css` (garder les couleurs).
> L'autre agent ne travaille plus → je possède tout le web. Full autonomie.

## Principe directeur
**Chaque page est un poste de travail, pas un dépotoir de formulaire/tableau.** Mener par l'état/contexte,
rendre l'objet principal proéminent, mettre le détail dans un **panneau latéral** (pas une nouvelle page),
dense + scannable, des **outils in-context**. Le plan de cour (`/yard`) et le dispatch sont les modèles.

## Système visuel (tokens chauds — NE PAS hardcoder de couleurs)
- Surfaces : `bg-canvas` (page), `bg-surface` (cartes), `border-edge-soft`, `shadow-sm`/`shadow-card`,
  `rounded-card` (conteneurs) / `rounded-inner`.
- **Orange accent (`bg-accent`/`text-accent`) UNIQUEMENT pour l'action primaire** + état actif. Pas de
  surcharge d'orange.
- Statuts via `Badge` + tones (`ok`/`warn`/`danger`/`info`/`neutral`) — jamais une couleur en dur.
- **Chiffres/ids/montants** : `font-mono` + tabular (déjà global) → alignés.
- Titres : `PageHeader` (gros, présent). Whitespace généreux. Sentence case. **Libellés FR cohérents.**
- États : hover/active/focus sur tout interactif (le `Button` les a déjà). Skeletons au chargement,
  `EmptyState` composé (jamais une page vide nue), erreurs en `toast`/inline (jamais `alert`).

## Archétypes de page → pattern imposé

### 1. Command center (dashboard)
Bandeau KPI vivants → **file d'attention** (« ce qui demande une action maintenant » : retards, exceptions,
approbations d'agents, quais/picks) → carte/board live proéminent → raccourcis d'action. **Pas de carte
« prose / how it works ».**

### 2. Master-data (carriers, customers, accessorials, fuel-tables, lanes, rates, settings/users,
### settings/api-keys, settings/modules, settings/sso, wms/items, wms/bins, yard/spots)
**Vue scindée** : liste cherchable à gauche (~38%) + **panneau détail/édition à droite**. Création inline
en tête. **Plus de table+modal** pour éditer. Lignes denses (fait-clé + statut). `EmptyState` composé.
(Si un split est trop lourd pour une page triviale, au minimum : table soignée + édition en `Panel` latéral,
pas un Modal centré.)

### 3. Liste opérationnelle (shipments, loads, transport-orders, invoices, billing/freight-audit)
En-tête avec KPI/filtres → liste avec statut par ligne → clic = **`Panel` latéral détail** (pas de page).
Modes Table/Board où ça aide. Filtres en `FilterBar`.

### 4. Postes-outils (dispatch, yard, yard/gate, wms, wms/inventory, wms/receiving, wms/picking,
### wms/fulfillment, fleet, fleet/[id], agents, workbench, agent-actions)
Déjà des outils → **polish léger** : cohérence warm, densité, états, retirer le « boxy » générique.

### 5. Pages détail (`[id]` : loads, transport-orders, fleet/vehicles, fleet/trailers, agents,
### billing/freight-audit)
Hero (titre + statut + méta-clé en ligne) → contenu en **sections** + actions ; éviter le mur de champs.

## Interdits
- Carte de prose explicative (« Workflow : A → B → C ») comme contenu.
- Un tableau brut comme seul contenu d'une page.
- Modal centré pour une édition simple (→ `Panel` latéral).
- Libellés anglais résiduels (`results`, etc.) → FR.
- 3 cartes égales génériques quand une mise en page plus dense convient.

## Contraintes techniques
- Svelte 5 runes ; composants `$lib/components/ui` ; `api()` (`$lib/api/client`) ; `toast`
  (`$lib/stores/toast`) ; `Panel` pour les latéraux.
- **Ne casser aucune fonctionnalité** : garder TOUS les appels API/endpoints existants et les actions.
- `pnpm --filter @pulsar/web typecheck` 0 erreur + `build` propre. pageSize ≤ 100.
- Ne PAS toucher `app.css`, `+layout.svelte`, ni les primitives `ui/` (gérés à part) — uniquement les
  `+page.svelte` (+ composants dédiés sous `$lib/components/<domaine>/` si besoin).

## Thème (à la toute fin, pas maintenant)
Refactor des tokens `app.css` en variantes `[data-theme]` + store localStorage + réglage dans
`/settings` pour changer de thème (warm par défaut). Garder les couleurs warm actuelles comme défaut.
