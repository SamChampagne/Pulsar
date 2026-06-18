# Pulsar Desk — placement libre (canvas pixel) — Design

> Date : 2026-06-17 · Branche : `ux-polish-pass` (suite) · Statut : approuvé (design)

## Problème

Le springboard `/apps` réorganise les icônes en **grille qui se tasse** (façon iPhone) :
glisser une icône décale les autres. L'utilisateur veut un **placement libre façon
Windows** : chaque icône reste exactement où on la lâche, sans réarrangement automatique.

## Objectif

Remplacer le modèle « liste ordonnée en grille » par un **canvas à coordonnées pixel** :
chaque item de premier niveau a une position `(x, y)` absolue ; on le déplace librement et il
reste là. **Travail limité au desk** (`/apps` + le modèle de layout dans `@pulsar/shared`).

## Décisions (validées)

| Sujet | Décision |
| --- | --- |
| Coordonnées | **Pixel `x/y` pur** sur un **canvas de largeur fixe** (scroll horizontal si écran plus étroit) |
| Réarrangement | **Aucun** auto-reflow ; chevauchement permis |
| Déclenchement du drag | **À tout moment** (seuil ~6px : clic = ouvrir, glisser = déplacer) — pas besoin du mode édition pour ranger |
| Dossiers | Maintien (dwell) sur une autre icône = créer/alimenter un dossier (conservé) |
| Recherche active | Bascule en **grille centrée** des résultats (x/y ignorés pour un sous-ensemble) |

## Non-objectifs (YAGNI)

- Pas de snap-to-grid (placement pixel pur, choix utilisateur).
- Pas de positions libres **dans** les dossiers (le dossier reste une grille).
- Pas de canvas responsive en % (positions stables en px ; petit écran ⇒ scroll, compromis accepté).
- Pas de multi-page/pagination du springboard.
- Pas de changement backend (le `deskLayout` JSON stocke déjà des items ; on y ajoute x/y).

---

## Architecture

### 1. Modèle de données — `@pulsar/shared/desk/desk-layout.ts`

Ajouter une position optionnelle aux items **de premier niveau** :

```ts
export interface DeskPosition { x: number; y: number }

// Les trois variantes de DeskItem gagnent `pos?: DeskPosition` (premier niveau seulement).
export type DeskItem =
  | { type: 'module'; moduleKey: string; pos?: DeskPosition }
  | { type: 'link'; href: string; label: string; icon?: string; pos?: DeskPosition }
  | { type: 'folder'; id: string; name: string; items: DeskFolderChild[]; pos?: DeskPosition };
// DeskFolderChild inchangé (les enfants de dossier n'ont pas de position).
```

Constantes de mise en page (exportées, pures) :
```ts
export const DESK_TILE = 96;      // largeur logique d'une tuile (px)
export const DESK_GAP = 28;       // espacement entre tuiles
export const DESK_COLS = 6;       // colonnes de la disposition par défaut
export const DESK_CANVAS_W = DESK_COLS * (DESK_TILE + DESK_GAP) + DESK_GAP; // largeur canvas
```

Fonctions pures (testées) :
- `defaultPosition(index: number): DeskPosition` — calcule une position en grille
  (`col = index % DESK_COLS`, `row = floor(index / DESK_COLS)`, `x = GAP + col*(TILE+GAP)`,
  `y = GAP + row*(TILE+GAP)`).
- `defaultDeskLayout(domains)` — comme aujourd'hui, mais assigne `pos = defaultPosition(i)` à
  chaque item dans l'ordre (modules puis dossier Framework).
- `reconcileDeskLayout(saved, domains)` — comme aujourd'hui (retrait des modules non visibles =
  sécurité, dédup d'ids), **plus** :
  - **préserve** le `pos` des items conservés ;
  - assigne `defaultPosition(nextFreeIndex)` à tout item conservé **sans** `pos` (anciens
    layouts) et aux modules nouvellement ajoutés. `nextFreeIndex` = compteur incrémental basé
    sur le nombre d'items déjà placés (déterministe, pas de `Math.random`/`Date.now`).
  - garantit que chaque item de premier niveau a un `pos` valide en sortie.

### 2. Canvas — `apps/web/src/routes/(app)/apps/+page.svelte`

- Remplacer la grille `grid grid-cols-…` par un **conteneur de positionnement** :
  `<div class="relative" style="width: {DESK_CANVAS_W}px; height: {canvasHeight}px">` où
  `canvasHeight` = max(`y + DESK_TILE + label`) sur les items + marge. Le conteneur vit dans un
  wrapper `overflow-x-auto` (scroll horizontal si la fenêtre < `DESK_CANVAS_W`).
- Chaque item rendu en `position:absolute; left:{pos.x}px; top:{pos.y}px` (tuile `DeskIcon` /
  `DeskFolderTile` inchangées visuellement).
- **Bornage (clamp)** : à la fin d'un drag, `x = clamp(0, x, DESK_CANVAS_W - DESK_TILE)`,
  `y = max(0, y)`. Empêche de perdre une icône hors zone.

### 3. Déplacement libre — action `apps/web/src/lib/actions/dnd.ts`

Remplacer la logique « index de grille » par un **déplacement absolu** :
- L'action (renommée mentalement « free drag », même fichier) suit le pointeur : sur
  `pointerdown` (seuil 6px) → début de drag, mémorise l'offset pointeur↔coin de la tuile ;
  sur `pointermove` → rapporte la nouvelle position `(x, y)` du coin de la tuile via
  `onmove(x, y)` ; sur `pointerup` → `ondrop(x, y, folderTargetId | null)`.
- **Drag à tout moment** : `enabled` n'est plus lié à `editing`. Le seuil 6px distingue
  clic (ouvre/navigue) de glisser (déplace). Un drag effectif **annule** le clic suivant
  (drapeau `moved` ⇒ la tuile garde son `onclick` mais l'action `preventDefault`/marque pour
  que `onactivate` ne se déclenche pas après un drag — détail d'implémentation, voir plan).
- **Dwell → dossier** : pendant le drag, si le pointeur stationne ~500 ms au-dessus d'une
  AUTRE tuile, on arme `folderIntent` sur cette cible (surbrillance) ; au drop sur cette
  cible → créer/alimenter un dossier (logique existante conservée) au lieu de poser des
  coordonnées. Sinon → poser `(x, y)`.
- La détection « au-dessus de quelle tuile » réutilise `document.elementFromPoint` +
  un attribut `data-desk-id` (id stable de l'item : `module:key` / `link:href` / `folder:id`)
  au lieu de `data-desk-index` (les index ne portent plus la sémantique de position).
- `pointercancel` annule proprement (déjà en place).

### 4. Recherche

`deskSearch` actif (`$deskSearch !== ''`) ⇒ rendre les items filtrés dans une **grille
centrée simple** (réutiliser un `flex flex-wrap`/`grid` temporaire), pas le canvas absolu —
les positions n'ont pas de sens pour un sous-ensemble. Vider la recherche ⇒ retour au canvas
positionné. Le drag est **désactivé** pendant une recherche (on ne déplace pas un sous-ensemble).

### 5. Mode édition

Le mode édition (« Personnaliser ») reste pour : **ajouter un lien** (tuile `+`), **retirer**
(× au survol/édition), **renommer**, **clic-droit**. Le **déplacement** n'en dépend plus
(dispo à tout moment). Le jiggle ne s'affiche qu'en mode édition (indication d'édition), mais
n'est pas requis pour déplacer.

---

## Fichiers touchés

| Fichier | Action |
| --- | --- |
| `packages/shared/src/desk/desk-layout.ts` | + `DeskPosition`, `pos?` sur items, constantes layout, `defaultPosition`, positions dans `defaultDeskLayout`/`reconcileDeskLayout` |
| `packages/shared/src/desk/desk-layout.spec.ts` | + tests positions (défaut en grille, préservation, assignation aux items sans pos / nouveaux modules, déterminisme) |
| `apps/web/src/lib/actions/dnd.ts` | passage de l'index-grille au **déplacement absolu** (onmove/ondrop x/y) + dwell→dossier + drag à tout moment |
| `apps/web/src/routes/(app)/apps/+page.svelte` | canvas absolu + scroll-x + clamp + rendu positionné + grille de recherche + drag libre |
| `apps/web/src/lib/components/desk/DeskIcon.svelte` / `DeskFolderTile.svelte` | inchangés visuellement (déjà `oncontext`/`editing`/`onremove`) |

## Tests / vérification

- **Unitaire** (`pnpm test`) : `desk-layout.spec.ts` — `defaultPosition` (grille), `defaultDeskLayout`
  assigne des `pos`, `reconcileDeskLayout` préserve les `pos` existants et en assigne aux items
  sans position / aux nouveaux modules, sortie déterministe (toEqual sur défaut), sécurité
  (retrait modules non visibles) préservée, clés/ids uniques.
- `pnpm --filter @pulsar/web typecheck` 0/0 ; `pnpm --filter @pulsar/web build` OK ; rebuild
  `@pulsar/shared`.
- **Vérification navigateur (chrome-devtools)** : icônes positionnées librement ; glisser une
  icône la laisse où on la lâche (aucune autre ne bouge) ; recharger → positions conservées
  (backend) ; maintien sur une autre icône → dossier ; clamp empêche la sortie de zone ;
  recherche → grille centrée ; **aucune erreur console** (régression `each_key_duplicate` :
  les clés restent uniques).

## Risques / points d'attention

- **Clic vs glisser** : bien gérer le seuil pour ne pas déclencher une navigation après un
  drag, ni bloquer un clic simple. C'est le point le plus délicat → vérif navigateur.
- **Petit écran** : canvas fixe ⇒ scroll horizontal (compromis accepté). Le clamp se fait sur
  `DESK_CANVAS_W`, pas sur la largeur de fenêtre, donc les positions restent stables.
- **Migration douce** : un layout sauvegardé SANS `pos` (créé par la version grille) doit
  recevoir des positions par défaut à la lecture (`reconcileDeskLayout`) — sinon icônes
  empilées en (0,0). Couvert par un test.
- **`each_key_duplicate`** : conserver des clés `{#each}` uniques (par `data-desk-id` + index si
  besoin) — ne pas réintroduire le crash corrigé.
- **Dwell pendant un drag libre** : ne pas confondre « survol transitoire en passant » et
  « intention de dossier » — garder le seuil 500 ms et l'annulation au changement de cible.
