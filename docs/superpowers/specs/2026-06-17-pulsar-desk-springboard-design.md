# Pulsar Desk — springboard personnalisable — Design

> Date : 2026-06-17 · Branche : `ux-polish-pass` (suite) · Statut : approuvé (design)

## Problème

La refonte précédente du desk `/apps` (passe UX, tâche 11) a fait **exploser chaque page**
de chaque module en icône, produisant une liste exhaustive. L'utilisateur veut au contraire
un **springboard façon iOS / ERPNext** : une icône par **module** (pas par page), entièrement
**personnalisable** (déplacer les icônes, créer des dossiers, ajouter des liens rapides),
avec une **animation d'ouverture de dossier** type iPhone. Il y a aussi **deux barres de
recherche** (celle du haut qui ouvre Ctrl+K, et l'input live de la page) : il faut n'en garder
qu'**une**, sur la barre du haut.

## Objectif

Transformer `/apps` en un launcher springboard personnalisable par utilisateur, persistant
côté backend. **Travail limité au Pulsar desk** (la grille `/apps` + la barre du haut en mode
desk) ; aucune autre page ni aucun autre comportement de l'app n'est modifié.

## Décisions (validées)

| Sujet | Décision |
| --- | --- |
| Concept | Springboard iOS : icônes = **modules** + liens rapides + dossiers |
| Persistance | **Backend par utilisateur** (`UserPreferences.deskLayout`) |
| Édition | **Mode « Personnaliser » (jiggle)** + menu **clic-droit** |
| Framework | Dossier **hub système + personnalisation** |
| Recherche | **Une seule** : la barre du **haut** devient un filtre live du springboard |

## Non-objectifs (YAGNI)

- Pas de personnalisation au-delà du desk (pas de thème/fond pour l'instant — réservé « plus tard »).
- Dossiers **un seul niveau** (pas de dossier dans un dossier), comme iOS.
- Pas de partage/synchro temps réel entre sessions ouvertes ; la sauvegarde est au fil des
  éditions (PUT), la dernière écriture gagne.
- Pas de grosse librairie de drag-and-drop : action Svelte native.
- Aucune nouvelle permission RBAC (endpoint self-service).

---

## Architecture

### 1. Backend — préférences utilisateur

**Prisma** (`packages/database/prisma/schema.prisma`) — nouveau modèle :

```prisma
model UserPreferences {
  id         String   @id @default(cuid())
  userId     String   @unique
  deskLayout Json     @default("{}")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

Ajouter la relation inverse `preferences UserPreferences?` sur `User`. Migration + regen client
+ rebuild `@pulsar/database`.

**API** (`apps/api/src/core/...`) — controller self-service `me/preferences` (pattern
`GET /auth/me` : `@ApiBearerAuth()` + `@CurrentUser()`, **aucune** `@RequirePermissions`) :

- `GET /api/v1/me/preferences` → renvoie `{ deskLayout }` du user courant (objet vide/normalisé
  si absent — l'enregistrement est créé paresseusement à la première écriture).
- `PUT /api/v1/me/preferences` → upsert `deskLayout` pour `@CurrentUser().id`.

Le service lit/écrit **par `userId` du JWT** (jamais depuis le body) → isolation tenant
implicite (règle 1). Le `deskLayout` est validé par un DTO class-validator (forme du layout :
`version:number`, `items: DeskItem[]`) — on valide la structure, pas les `href` métier (le web
ne propose que des pages du catalogue, et la lecture re-réconcilie de toute façon).

### 2. Modèle de données du desk — `@pulsar/shared` (pur, browser-safe, zéro import Node)

Nouveau fichier `packages/shared/src/desk/` (exporté par l'index), **pure data + fonctions
pures** (même esprit que `RUNTIME_PROVIDERS`/`AGENT_ROLE_PRESETS`) :

```ts
export type DeskItem =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string }
  | { type: 'folder'; id: string; name: string; items: DeskFolderChild[] };
// les dossiers ne contiennent que des modules ou des liens (1 niveau)
export type DeskFolderChild =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string };

export interface DeskLayout {
  version: number;       // pour migrations futures
  items: DeskItem[];
}
```

Fonctions pures :

- `defaultDeskLayout(domains: { key: string }[]): DeskLayout`
  Construit le springboard initial : une icône `module` par domaine visible (dans l'ordre du
  catalogue) + un dossier `Framework` (id stable `'framework'`) contenant les liens système.
  Le `Framework` est un dossier normal du layout (pas un cas spécial codé dans la vue).
- `reconcileDeskLayout(saved: unknown, domains: { key: string }[]): DeskLayout`
  - parse défensif (si `saved` invalide → `defaultDeskLayout`).
  - **retire** tout item/enfant `module` dont le `key` n'est pas dans `domains` (sécurité :
    un module non visible ne s'affiche jamais — règle 1/RBAC). Les `link` sont conservés tels
    quels (le web ne propose que des hrefs du catalogue visible à l'ajout).
  - **ajoute** à la fin les modules de `domains` absents du layout (nouvel accès → nouvelle
    icône), en évitant les doublons (présence comptée aussi dans les dossiers).
  - garantit l'unicité des `id` de dossier ; renvoie toujours un `DeskLayout` valide.

Ces fonctions sont **testables unitairement** (le repo teste `packages/shared` via
`pnpm test`) — on ajoute un `.spec.ts`.

### 3. Web — `/apps` springboard (`apps/web/src/routes/(app)/apps/+page.svelte`)

État : `layout = $state<DeskLayout>` chargé via `GET /me/preferences` puis
`reconcileDeskLayout(saved, domains)` (domains = `visibleDomains(caps)` comme aujourd'hui).
Si le chargement échoue → `defaultDeskLayout(domains)` (best-effort, jamais d'écran cassé).

**Rendu** : grille d'icônes (style actuel conservé : tuiles arrondies, accent par
`MODULE_UNIVERSES`, hover lift). Trois rendus d'item :
- `module` → tuile accent + icône du domaine ; clic → `goto(domain.home)`.
- `link` → tuile + label ; clic → `goto(href)`.
- `folder` → tuile « aperçu 4 mini-tuiles » ; clic → **ouverture animée** (voir plus bas).

**Mode édition** (`editing = $state(false)`, bouton « Personnaliser » / « OK » en haut) :
- jiggle (animation `animate-[wiggle]` désactivée en `prefers-reduced-motion`).
- **drag-and-drop** via une petite action Svelte native (`use:draggable`/`use:dropzone`) :
  réordonner dans la grille, déposer une icône sur une autre → **créer un dossier**, déposer
  dans/hors d'un dossier ouvert, sortir d'un dossier.
- badge `(×)` pour retirer un item (un `module` retiré peut être re-ajouté depuis « + », il
  reste dans le catalogue ; on ne supprime jamais l'accès, juste l'icône).
- bouton `+` → **sélecteur de lien rapide** : liste à plat toutes les pages de
  `visibleDomains(caps)` (label + domaine), recherche, ajout comme `link`.
- renommer un dossier / un lien (champ inline).
- chaque mutation met à jour `layout` et déclenche un **PUT debounced** (~500 ms) vers
  `/me/preferences` ; toast discret en cas d'échec (non bloquant).

**Clic-droit** (sur une icône, n'importe quand) : menu contextuel maison
(`Renommer`, `Retirer`, `Nouveau dossier`, `Ajouter un lien rapide`). Ferme sur clic-extérieur/Esc.

**Animation d'ouverture de dossier (iOS)** : tap dossier → overlay plein écran : fond du desk
flouté/assombri (`backdrop-blur`), et le panneau du dossier **zoome** depuis la position de
l'icône (`scale` 0.4→1 + fondu, ~220 ms, `ease-out`) vers un panneau centré listant ses items ;
fermeture inverse. Réutilise la mécanique d'overlay-stack existante (Esc/clic-fond ferme).
Respecte `prefers-reduced-motion` (apparition instantanée).

**Framework** : c'est l'item `folder` d'id `'framework'` du layout par défaut. Son contenu :
liens système (`Réglages`, `Données`, `Utilisateurs`, `Automation`, `Modules`) **plus** une
petite section perso dans le panneau ouvert : « Réinitialiser la disposition » (remet
`defaultDeskLayout` + PUT) et « Gérer les liens rapides » (ouvre le mode édition). L'utilisateur
peut le déplacer/renommer comme un dossier normal.

### 4. Barre du haut = recherche unique (`apps/web/src/routes/(app)/+layout.svelte`, bloc `deskMode`)

Le header `deskMode` a aujourd'hui un **bouton** « Search » qui ouvre Ctrl+K. On le remplace par
un **input live** lié à un store partagé (`deskSearch`, p.ex. `apps/web/src/lib/stores/desk.ts`)
que `/apps` lit pour filtrer le springboard (par label de module/lien/dossier ; un dossier
matche si lui ou un enfant matche). On **supprime l'input de recherche de la page** `/apps`.
Ctrl+K (palette globale) reste disponible (raccourci clavier inchangé). Quand on n'est pas sur
`/apps`, l'input du header reste mais le filtre n'a pas d'effet de springboard (il peut alors
soit être masqué hors `/apps`, soit rediriger vers `/apps` à la saisie — **choix retenu :
masquer/ne montrer l'input que sur `/apps`** ; ailleurs en deskMode (`/framework`) garder le
bouton Ctrl+K actuel).

---

## Fichiers touchés / créés

| Fichier | Action |
| --- | --- |
| `packages/database/prisma/schema.prisma` | + modèle `UserPreferences` (+ relation sur `User`) |
| `packages/database/prisma/migrations/*` | + migration |
| `packages/shared/src/desk/desk-layout.ts` | **créé** — types + `defaultDeskLayout` + `reconcileDeskLayout` |
| `packages/shared/src/desk/desk-layout.spec.ts` | **créé** — tests des fonctions pures |
| `packages/shared/src/index.ts` | export du module `desk` |
| `apps/api/src/core/<me>/preferences.controller.ts` + `.service.ts` + `dto` | **créés** — `GET`/`PUT /me/preferences` |
| `apps/api/src/app.module.ts` | enregistrement du module/controller |
| `apps/web/src/lib/api` ou page | client `GET/PUT /me/preferences` |
| `apps/web/src/lib/stores/desk.ts` | **créé** — store `deskSearch` (+ helpers) |
| `apps/web/src/routes/(app)/apps/+page.svelte` | **refonte** springboard (rendu, édition, DnD, dossiers, animation) |
| `apps/web/src/lib/components/desk/*` | **créés** — composants (DeskIcon, DeskFolder, FolderOverlay, AddLinkPicker, ContextMenu) pour garder la page focalisée |
| `apps/web/src/routes/(app)/+layout.svelte` | barre du haut : bouton → input live (desk only) |

## Tests / vérification

- **Unitaire** (`pnpm test`) : `desk-layout.spec.ts` couvre `defaultDeskLayout` et
  `reconcileDeskLayout` (retrait des modules non visibles = **sécurité**, ajout des nouveaux,
  parse défensif d'un layout corrompu, unicité des ids).
- **API e2e** (optionnel, si une suite légère est simple) ou au minimum typecheck : `GET` renvoie
  un layout normalisé, `PUT` upsert et relit, isolation par user.
- `pnpm typecheck` tous workspaces : 0 erreur.
- `pnpm --filter @pulsar/web build` : OK.
- Vérification manuelle dans l'app : icônes = modules ; créer/ouvrir un dossier (animation) ;
  drag-réorganiser ; ajouter un lien rapide ; clic-droit ; recharger → disposition conservée
  (backend) ; une seule barre de recherche (celle du haut) filtre le springboard ; un module
  désactivé pour le tenant disparaît du desk au prochain chargement.

## Risques / points d'attention

- **Sécurité d'affichage** : `reconcileDeskLayout` DOIT retirer tout module hors
  `visibleDomains` à la lecture — ne jamais faire confiance au layout stocké pour la visibilité
  (règle 1). Les `link` ajoutés viennent du catalogue visible ; un lien vers une page perdue
  reste cliquable mais le route guard protège la page (acceptable).
- **DnD natif** : gérer proprement le toucher/desktop ; rester simple (réordonner + dossier).
  Si le DnD natif s'avère trop fragile, une action `use:` minimale basée sur pointer events est
  acceptable — pas de dépendance lourde (YAGNI).
- **Best-effort backend** : échec de `GET`/`PUT` ⇒ desk fonctionne sur le défaut/local en
  mémoire, toast discret, jamais d'écran cassé.
- **`UserPreferences` générique** : on n'y met que `deskLayout` aujourd'hui ; le modèle est
  volontairement extensible (futur thème/densité côté serveur) sans sur-concevoir maintenant.
- **Migration** : nécessite `pnpm db:migrate` local ; le dev doit l'appliquer.
