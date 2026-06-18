# Desk — Personnalisation & polish

Date : 2026-06-18 · Branche : `ux-polish-pass`

## Contexte

Le **Pulsar Desk** (`/apps`) est un springboard personnalisable (modes auto/free/reorder,
dossiers, liens rapides) dont le layout est persisté par utilisateur en BD
(`UserPreferences.deskLayout`). Le thème global (Chaud/Ardoise/Nuit) vit séparément en
**localStorage** (`stores/theme.ts`), appliqué via `[data-theme]` + tokens CSS `--t-*`.

Cette itération couvre deux choses :

1. **Cinq correctifs/ajustements** du Desk remontés par l'usage.
2. Une **couche de personnalisation** : couleur d'accent globale, fond du Desk
   (couleur / dégradé / image uploadée), taille des tuiles — le tout persisté **par
   utilisateur en BD**.

## Décisions validées (brainstorm)

- Centrage : **board centré borné** commun aux 3 modes (pas de canvas pleine largeur).
- Couleurs : **accent personnalisé** uniquement (pas d'éditeur de palette complet).
- Fond du Desk : couleur unie + **dégradés presets** + **image uploadée** (wallpaper).
- Stockage : **par utilisateur en BD** ; le thème migre de localStorage → BD avec cache
  localStorage pour appliquer sans flash au boot.
- Menu contextuel : **clic-droit** conservé comme convention (pas de menu au clic gauche).

## 1. Correctifs Desk

### 1.1 Board centré borné (`#1` centrage, `#5` tuiles sous la barre)

- Un conteneur unique de largeur fixe `DESK_CANVAS_W` (6 colonnes ≈ 772 px), `mx-auto`,
  posé sous la top-bar (le `py-14` existant de la section le maintient sous la barre
  `sticky h-14`). `position: relative` → contexte de positionnement du mode libre.
- **auto / reorder** : grille centrée dans le board (`justify-center`).
- **free** : positionnement absolu **relatif au board** ; `clampX/clampY` bornent à
  `[0, largeurBoard - tile]` / `[0, hauteurBoard - tile]`. Conséquence : aucune tuile ne
  peut finir sous la barre, et le bloc reste centré.
- Migration douce : les positions libres déjà sauvées hors-bornes (canvas large précédent)
  sont **clampées au rendu/chargement** dans le board.

### 1.2 Bug « reset au retour d'un module » (`#2`)

- **Cause** : l'effet de re-réconciliation (`/apps/+page.svelte`) réapplique
  `reconcileDeskLayout(rawSaved, domains)` à chaque changement de référence de `domains`,
  écrasant les positions/dossiers *live* avec l'état figé au chargement (`rawSaved`).
- **Fix** :
  1. Réconcilier à partir du **layout courant** (`reconcileDeskLayout(layout, domains)`) et
     non du `rawSaved` figé → préserve positions, dossiers, mode, fond, tileSize ; ne fait
     qu'ajouter les modules apparus et retirer les modules disparus.
  2. Ne déclencher la réconciliation que si la **signature des clés de modules visibles**
     a réellement changé (comparaison d'un set de clés, pas de référence d'array).
  3. Maintenir `rawSaved` synchronisé avec `layout` à chaque `persist()`.
- `reconcileDeskLayout` doit donc **préserver** `background` et `tileSize` (cf. §4/§3).

### 1.3 Framework toujours présent + « Personnaliser » dedans (`#3`)

- `reconcileDeskLayout` **ré-injecte** le dossier Framework (`FRAMEWORK_FOLDER_ID`) s'il est
  absent du layout sauvé — symétrique du ré-ajout des modules manquants. Position en fin de
  liste, contenu = `FRAMEWORK_LINKS`.
- Ajout d'une action **« Personnaliser le bureau »** dans le pied du dossier Framework
  (`FolderOverlay` footer) qui entre en mode édition (`editing = true`), à côté de
  *Gérer les liens rapides* / *Réinitialiser la disposition*. Le bouton top-bar
  « Personnaliser » reste pour la découvrabilité.

### 1.4 Menu contextuel sur l'espace vide (`#4`)

- Clic-droit sur le **vide du board** (pas seulement sur une tuile) ouvre `DeskContextMenu`
  avec *Nouveau dossier* + *Ajouter un lien rapide*.
- `AddLinkPicker` liste **déjà** toutes les sous-pages de modules (`domain.sections →
  s.links`) → « ajouter un lien vers un sous-menu de module » est couvert dès que le picker
  est atteignable. Aucune logique de picker à changer.

## 2. Accent personnalisé (global, toute l'UI)

- Sélecteur de couleur dans **Réglages › Apparence** (`settings/appearance/+page.svelte`),
  sous le choix de thème.
- Override appliqué sur `:root` : `--t-accent` = couleur choisie ; `--t-accent-hover`
  (assombrie ~10 %) et `--t-accent-soft` (teinte claire) **dérivées en JS** à partir de
  l'accent. Helper pur dans `@pulsar/shared` (`deriveAccent(hex) → { accent, hover, soft }`)
  pour rester testable et réutilisable.
- Application via `document.documentElement.style.setProperty('--t-accent', ...)`. Reset →
  on retire les overrides inline et on retombe sur les tokens du thème.
- L'accent **s'empile par-dessus** le thème choisi (Chaud/Ardoise/Nuit) ; changer de thème
  ne perd pas l'accent custom.

## 3. Fond du Desk

- `deskLayout.background?: DeskBackground` avec
  `DeskBackground = { type: 'color'; value: string } | { type: 'gradient'; value: string }
  | { type: 'image'; value: string }`.
  - `color` → couleur CSS unie.
  - `gradient` → **id** d'un preset curé (catalogue `DESK_GRADIENTS` dans `@pulsar/shared`,
    pure data : `{ id, label, css }`). On stocke l'id, pas le CSS, pour rester stable.
  - `image` → **id de document** (`Document.id`) uploadé via `DocumentsService` (règle 12).
- Défaut (absent) → fond neutre actuel (équivalent `#f8f8f7` / token canvas).
- **Rendu image** : le endpoint `/api/v1/documents/:id/download` est authentifié (JWT) →
  incompatible avec `background-image: url()`. Le Desk récupère donc l'image en **blob via
  le client API authentifié** puis `URL.createObjectURL` → CSS background. Marche avec le
  driver local (dev) et S3 (prod). L'object URL est révoqué à la destruction du composant.
- **Lisibilité** : sous un fond image/dégradé sombre, un voile (`bg-surface/xx` ou overlay
  semi-opaque) est posé derrière les tuiles pour garder labels/icônes lisibles.
- **Upload** : depuis Réglages › Apparence (ou le mode édition du Desk), `POST
  /documents/upload` (multipart, images uniquement, taille raisonnable) → on stocke l'id
  retourné dans `deskLayout.background`. Pas de nouvel endpoint côté API.

## 4. Taille des tuiles

- `deskLayout.tileSize?: 'sm' | 'md' | 'lg'` → `76 / 96 / 120` px (défaut `md` = `DESK_TILE`
  actuel = 96, rétrocompatible). Mapping `TILE_SIZES` pur dans `@pulsar/shared`.
- `DeskIcon` et `DeskFolderTile` paramétrés par la taille (px + tailles de police/icône
  proportionnelles). En mode libre, `clampX/clampY` et `defaultPosition` utilisent la taille
  effective ; les gaps de grille s'adaptent.
- Réglage exposé en mode édition du Desk (sélecteur S/M/L).

## 5. Persistance (par utilisateur, BD)

### 5.1 Modèle

- **Global** (thème + accent) → nouveau champ `appearance` dans `UserPreferences` :
  `appearance: { theme?: 'warm'|'cool'|'dark'; accent?: string }` (JSON, nullable).
- **Desk** (background + tileSize) → champs dans `deskLayout`
  (`DeskLayout.background`, `DeskLayout.tileSize`).
- Migration Prisma légère : ajout colonne `appearance Json?` sur `user_preferences`
  (pas de nouvelle table, pas de backfill — null = défauts).

### 5.2 API

- `GET /me/preferences` renvoie aussi `appearance`.
- `PUT /me/preferences` : étendre le DTO (whitelist) pour accepter `appearance`,
  `deskLayout.background`, `deskLayout.tileSize` — sinon **400 sous
  `forbidNonWhitelisted`** (cf. commit récent `fix(api): allow deskLayout.mode`). Validation
  class-validator (enum theme, hex accent, enum tileSize, shape background).

### 5.3 Application sans flash (boot)

- `stores/theme.ts` (ou un nouveau `stores/appearance.ts`) :
  - Au boot : lire le **cache localStorage** (`theme` + `accent`) et appliquer
    immédiatement (`data-theme` + override `--t-accent`) → zéro flash.
  - Après chargement des prefs (`GET /me/preferences` post-auth) : appliquer les valeurs BD
    (source de vérité) et **rafraîchir le cache localStorage**.
  - Toute modification UI : `setTheme`/`setAccent` appliquent + persistent en BD (debounce)
    + mettent à jour le cache.
- Le fond/tileSize du Desk n'ont pas de problème de flash (visibles uniquement sur `/apps`,
  après chargement des prefs) → pas de cache nécessaire.

## Périmètre fichiers

- `packages/shared/src/desk/desk-layout.ts` (+ `.spec.ts`) : `DeskBackground`, `tileSize`,
  `TILE_SIZES`, `DESK_GRADIENTS`, `deriveAccent`, préservation dans `reconcileDeskLayout`,
  ré-injection Framework.
- `apps/web` : `routes/(app)/apps/+page.svelte` (board centré, fix reset, menu vide, fond,
  tileSize), `routes/(app)/settings/appearance/+page.svelte` (accent + fond + upload),
  `lib/stores/theme.ts` → appearance, `lib/components/desk/{DeskIcon,DeskFolderTile,
  DeskContextMenu,FolderOverlay}.svelte`, store/API prefs (`lib/api/preferences.ts`).
- `apps/api` : DTO `PUT /me/preferences` (whitelist + validation).
- `packages/database` : `UserPreferences.appearance Json?` + migration.

Rebuild `@pulsar/shared` puis `@pulsar/database` après modif (règle 7). Pas de nouvelle
entité, upload via `DocumentsService` existant.

## Hors-scope (YAGNI)

Éditeur de palette complet / thème custom intégral · polices personnalisées · multi-wallpaper
ou rotation · personnalisation par-tenant (reste par-utilisateur) · redimensionnement libre
tuile-par-tuile · menu contextuel au clic gauche.

## Critères de succès

1. Les apps sont centrées dans les 3 modes ; en mode libre on ne peut plus glisser une tuile
   sous la top-bar.
2. Entrer dans un module puis revenir sur `/apps` **préserve** la disposition libre (plus de
   reset).
3. Le dossier Framework réapparaît s'il manquait ; « Personnaliser le bureau » y est
   accessible.
4. Clic-droit sur le vide du board propose *Nouveau dossier* / *Ajouter un lien rapide*.
5. Choisir une couleur d'accent change l'accent de toute l'UI et persiste (suit le compte,
   pas de flash au rechargement).
6. Le fond du Desk accepte couleur / dégradé preset / image uploadée ; l'image s'affiche en
   dev (driver local) et reste lisible (voile).
7. La taille des tuiles (S/M/L) s'applique et persiste.
8. `pnpm typecheck` + `pnpm test` (specs `@pulsar/shared`) verts.
