# Pulsar Desk — modes d'affichage + plein écran — Design

> Date : 2026-06-17 · Branche : `ux-polish-pass` (suite) · Statut : approuvé (design)

## Problème

Le desk `/apps` est aujourd'hui un canvas à placement libre (pixel), dans une boîte de
largeur fixe (~772 px) centrée avec barre de défilement. L'utilisateur veut :
1. Pouvoir **choisir le mode d'affichage** dans Personnaliser : **Grille auto**, **Libre
   (canvas)**, **Réordonnable (iPhone)**.
2. Le desk **plein écran** (toute la zone sous la barre du haut) — pas de boîte étroite ni de
   barre de défilement, et plus d'icône qui « disparaît » quand on la traîne trop loin.

(Le bug « clic mort » est déjà corrigé séparément : capture du pointeur seulement au début
d'un vrai drag.)

## Décisions (validées)

| Sujet | Décision |
| --- | --- |
| Modes | Trois : `auto` (Grille auto), `free` (Libre/canvas), `reorder` (Réordonnable iPhone) |
| Défaut | `auto` (propre d'emblée) |
| Plein écran | La zone desk occupe toute la largeur/hauteur sous la barre du haut |
| Sélecteur | Segmented control dans **Personnaliser**, persiste immédiatement |
| Action de drag | Une seule action `freeDrag` réutilisée (free + reorder) ; `auto` = pas de drag |

## Non-objectifs (YAGNI)

- Pas de positions libres dans les dossiers (le dossier reste une grille).
- Pas de snap-to-grid en mode `free` (placement pixel pur).
- Pas de tailles d'icônes configurables, pas de fond/thème (réservé plus tard).

---

## Architecture

### 1. Modèle — `@pulsar/shared/desk/desk-layout.ts`

```ts
export type DeskMode = 'auto' | 'free' | 'reorder';
export const DESK_MODES: DeskMode[] = ['auto', 'free', 'reorder'];

export interface DeskLayout {
  version: number;
  mode: DeskMode;     // nouveau (défaut 'auto')
  items: DeskItem[];
}
```

- `defaultDeskLayout(domains)` → `mode: 'auto'`.
- `reconcileDeskLayout(saved, domains)` → conserve `saved.mode` s'il est un `DeskMode` valide,
  sinon `'auto'`. (Les anciens layouts sans `mode` deviennent `'auto'`.)
- `pos` reste sur les items ; il n'est **lu** qu'en mode `free` (les autres modes ordonnent par
  l'index du tableau). Le `pos` est conservé entre les changements de mode (revenir en `free`
  retrouve les positions).

Tests : `defaultDeskLayout` a `mode==='auto'` ; `reconcileDeskLayout` préserve un mode valide,
remplace un mode invalide / absent par `'auto'` ; déterminisme conservé.

### 2. Plein écran — `apps/web/src/routes/(app)/apps/+page.svelte`

- La `<section>` du desk devient **pleine largeur** et **pleine hauteur** sous la barre du haut
  (`min-h-[calc(100vh-3.5rem)]` déjà présent ; retirer la contrainte `max-w-5xl`/`max-w-[780px]`
  pour le contenu). Le fond `#f8f8f7` couvre tout.
- Mesurer la largeur/hauteur réelles de la zone via `bind:clientWidth`/`bind:clientHeight` sur le
  conteneur (`let canvasW`, `let canvasH`). Le **clamp** du mode `free` utilise `canvasW`/`canvasH`
  (`x ∈ [0, canvasW - DESK_TILE]`, `y ∈ [0, canvasH - DESK_TILE]`) → plus de barre de défilement,
  plus d'icône perdue. `DESK_CANVAS_W` (constante fixe) n'est plus utilisée pour borner le canvas
  (on garde la constante pour la grille par défaut des positions).

### 3. Rendu par mode

- **`auto` et `reorder`** : même markup — une grille fluide (`flex flex-wrap` ou
  `grid` responsive) des items dans l'ordre du tableau, centrée/à gauche, occupant la largeur.
  Tuiles `DeskIcon`/`DeskFolderTile` inchangées.
- **`free`** : canvas `relative` plein écran ; chaque item en `position:absolute; left:pos.x;
  top:pos.y` (avec `pos ?? defaultPosition(i)`). La tuile en cours de drag est
  `pointer-events:none` (déjà en place) pour la détection de cible.
- Recherche active : dans tous les modes, on bascule en **grille centrée des résultats**
  (comme aujourd'hui) et le drag est désactivé.

### 4. Drag selon le mode (action `freeDrag` étendue)

Étendre `freeDrag` (`apps/web/src/lib/actions/dnd.ts`) pour rapporter, au drop, **aussi** la
tuile actuellement survolée (pas seulement la cible de dwell) :
```ts
ondrop: (x: number, y: number, folderTargetId: string | null, overTargetId: string | null) => void;
```
(`overTargetId` = `lastTargetId` au moment du `pointerup`.)

Branche-le selon `layout.mode` dans la page :
- **`auto`** : ne pas attacher `use:freeDrag` (drag désactivé). Edit/clic-droit toujours dispos.
- **`free`** : `folderTargetId` (dwell) → dossier ; sinon → `pos = clamp(x,y)`.
- **`reorder`** : `folderTargetId` (dwell) → dossier ; sinon si `overTargetId` → **réinsérer**
  l'item dragué juste avant l'item cible dans `layout.items` (réordonnancement) ; sinon no-op.

La création de dossier (dwell) reste identique dans `free` et `reorder`.

### 5. Sélecteur de mode (dans Personnaliser)

Quand `editing` est vrai, afficher un segmented control près du bouton « OK » :
`Libre | Grille auto | Réordonnable`. Sélectionner met `layout = { ...layout, mode }` puis
`persist()`. (Hors édition, pas de sélecteur — le desk s'affiche selon le mode courant.)
Réutiliser le style des toggles existants (cf. `ViewToggle`/segmented des listes).

---

## Fichiers touchés

| Fichier | Action |
| --- | --- |
| `packages/shared/src/desk/desk-layout.ts` | + `DeskMode`, `DESK_MODES`, `mode` sur `DeskLayout`, défaut/préservation dans default/reconcile |
| `packages/shared/src/desk/desk-layout.spec.ts` | + tests mode (défaut auto, préservation, invalide→auto) |
| `apps/web/src/lib/actions/dnd.ts` | `freeDrag.ondrop` rapporte `overTargetId` (tuile survolée au drop) |
| `apps/web/src/routes/(app)/apps/+page.svelte` | plein écran (clientWidth/Height + clamp), rendu par mode (grille auto/reorder vs canvas free), drop par mode (pos / reorder / folder), sélecteur de mode en édition |

## Tests / vérification

- **Unitaire** (`pnpm test`) : `desk-layout.spec.ts` — mode défaut `auto`, préservation d'un mode
  valide, fallback `auto` sur mode absent/invalide, positions toujours assignées, déterminisme,
  pas de régression sécurité (retrait modules non visibles).
- `pnpm --filter @pulsar/web typecheck` 0/0 ; rebuild `@pulsar/shared` ; `build` web OK.
- **Vérification navigateur (chrome-devtools)** — pour chaque mode :
  - `auto` : icônes en grille rangée, drag ne déplace pas, clic ouvre/navigue, plein largeur.
  - `free` : drag pose l'icône (plein écran, pas de scroll-x, clamp aux bords → pas de disparition),
    dwell → dossier, persistance reload.
  - `reorder` : drag réordonne (l'ordre change), dwell → dossier.
  - sélecteur de mode dans Personnaliser change le rendu et persiste (reload conserve le mode).
  - clic simple ouvre/navigue dans tous les modes ; **0 erreur console** ; pas de
    `each_key_duplicate` (clés `{#each}` uniques via id+index).

## Risques / points d'attention

- **Régression du clic** (corrigée) : ne pas recapturer le pointeur au pointerdown ; garder la
  capture au franchissement du seuil.
- **Plein écran** : la mesure `clientWidth/Height` doit être prête avant le premier clamp ; au
  pire, fallback sur `DESK_CANVAS_W`/une hauteur mini si `0`. Le clamp se recalcule au resize.
- **Reorder vs free partage `freeDrag`** : bien distinguer `folderTargetId` (dwell, 500 ms) de
  `overTargetId` (survol au drop) ; un simple survol rapide ne doit pas créer de dossier.
- **`each_key_duplicate`** : conserver des clés `{#each}` uniques (id + index) dans tous les
  rendus (grille auto/reorder et canvas).
- **Migration** : un layout `free` déjà sauvegardé (positions) garde ses positions ; comme le
  défaut passe à `auto`, un layout SANS `mode` s'affichera désormais en grille auto (les
  positions restent stockées et reviennent si l'utilisateur repasse en `free`).
