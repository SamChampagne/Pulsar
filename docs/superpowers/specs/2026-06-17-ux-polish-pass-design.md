# Passe de polish UX transversale — Design

> Date : 2026-06-17 · Branche cible : à créer depuis `main` · Statut : approuvé (design)

## Problème

L'application accumule des frictions UX qui « polluent » l'expérience (feedback Sam) :

1. **Formulaires incohérents** — trois patterns coexistent : inline dans la page (Fleet
   roster, sans bouton qui ouvre), drawer étroit 360 px à droite (Lieux), et modale centrée
   (WMS). Pas de standard ; le drawer est petit et peu lisible.
2. **Master-détail confus** — Réception (`/wms/receiving`) et Prélèvement (`/wms/picking`)
   fonctionnent en « clic sur une 1re colonne peu parlante → l'info apparaît dans une 2e
   colonne vide ». UX déroutante, pas de page dédiée par document.
3. **Vues incomplètes** — seuls Shipments / Loads / Transport Orders / Dispatch ont un
   toggle de vues (table/kanban/carte/map). Le reste est en table plate, même pour des
   listes opérationnelles.
4. **Découvrabilité** — plusieurs pages existent mais ne sont pas surfacées sur le desk
   `/apps` (Control Tower, Finance, Locations, Assets, Audit, Framework…). Elles sont
   « introuvables » pour qui ne connaît pas l'URL.
5. **Manque de fluidité** — aucune transition de route, états de chargement inégaux (page
   blanche vs skeleton selon la page).

## Objectif

Établir des **standards UX réutilisables** et migrer l'existant dessus, sans changer la
logique métier ni les contrats API. Travail 100 % `apps/web` + composants partagés
`apps/web/src/lib/components/ui`.

## Non-objectifs (YAGNI)

- Aucun changement d'API, de schéma Prisma, de permissions ou de logique métier.
- Pas de toggle de vues sur les données de référence (rates, lanes, carriers, accessorials,
  fuel tables) — elles restent en table.
- Pas de refonte visuelle de la charte (couleurs, typo) ni de nouveau design system.
- Pas de librairie d'animation externe — on utilise les transitions Svelte natives.

## Décisions (validées)

| Sujet | Décision |
| --- | --- |
| Standard formulaire | Modale centrée animée **partout** ; le drawer `Panel` est retiré |
| Master-détail WMS | **Pages dédiées** `/wms/receiving/[id]` et `/wms/picking/[id]` |
| Vues listes | Ajout table/cartes (+kanban si statut) aux **listes opérationnelles seulement** |
| Desk `/apps` | **Lanceur complet** groupé par domaine, recherche, source unique de nav |
| Fluidité | Transition de route courte + skeletons uniformes |

---

## Chantier 1 — Modale standard

### Composant `Modal.svelte` (enrichi, existant)

Le composant `apps/web/src/lib/components/ui/Modal.svelte` existe déjà (centré, backdrop,
overlay-stack). On l'enrichit pour qu'il devienne LE standard :

- **Scrim** gris semi-opaque (`bg-black/40` ou jeton existant) couvrant tout l'écran ;
  le contenu derrière n'est **pas** interactif.
- **Scroll lock** du `body` tant qu'une modale est ouverte (compteur via overlay-stack pour
  gérer l'empilement).
- **Focus trap** : focus piégé dans la modale ; au montage, focus sur le premier champ ou
  le bouton de fermeture ; à la fermeture, restaure le focus sur l'élément déclencheur.
- **Animation** : scrim en `fade` (~120 ms) ; panneau en `scale`+`fade` (95 %→100 %,
  ~150 ms, `ease-out`), inverse à la fermeture. Respecte `prefers-reduced-motion`
  (transitions désactivées si l'utilisateur le demande).
- **Tailles** : prop `size` = `sm | md | lg | xl` (largeurs max standard). Corps en
  `max-h` avec scroll interne ; header (titre + close) et footer (actions) collants.
- **Fermeture** : `Esc` et clic sur le scrim (déjà géré par `overlay-stack`), plus bouton
  close explicite dans le header.

Interface (props) : `open` (bindable), `title`, `size`, `onclose`, slots `default` (corps)
et `footer` (actions). Doit rester rétro-compatible avec les usages WMS actuels.

### Retrait du `Panel`

`Panel.svelte` (drawer 360 px) est **supprimé** après migration de tous ses usages :

- **Lieux** (`/locations`) — form create/edit → `Modal`.
- **WMS picking / receiving** — leurs détails déménagent en pages dédiées (chantier 2),
  donc plus de `Panel`.
- **Loads detail** et autres consultations en `Panel` → `Modal` (lecture) ou page dédiée si
  déjà existante.

Recherche exhaustive des imports de `Panel` avant suppression ; zéro import restant =
condition de fin.

### Migration Fleet roster

`/fleet/+page.svelte` : le formulaire inline (tabs Véhicule/Remorque/Chauffeur) devient un
bouton **« Ajouter »** dans le `PageHeader` qui ouvre la `Modal` (les tabs vivent dans la
modale). Idem pour la création de planning de maintenance préventive.

---

## Chantier 2 — Pages dédiées Réception & Prélèvement

### Routes

- `apps/web/src/routes/(app)/wms/receiving/[id]/+page.svelte` — détail d'une `Receipt`.
- `apps/web/src/routes/(app)/wms/picking/[id]/+page.svelte` — détail d'un `PickOrder`.

Chaque page détail affiche en avant : en-tête (n° doc, statut, emplacement, dates),
lignes du document, actions de workflow (boutons gated par permission), et formulaires
d'édition de ligne en **modale** (chantier 1). Pattern aligné sur les pages détail
existantes (`/loads/[id]`, `/transport-orders/[id]`).

### Listes

`/wms/receiving/+page.svelte` et `/wms/picking/+page.svelte` deviennent de **vraies listes**
(table + cartes, chantier 3) où chaque ligne/carte est cliquable et navigue vers la page
détail. Plus de `Panel` ni de 2e colonne. État vide explicite (`EmptyState`).

Les appels API restent inchangés (mêmes endpoints list + get-by-id).

---

## Chantier 3 — Vues listes opérationnelles

### Composant `ViewToggle.svelte` (nouveau)

Aujourd'hui la logique de toggle (`view = $state<'table'|'kanban'|'map'>`) + les icônes sont
copiées-collées dans Shipments/Loads/Transport Orders/Dispatch. On extrait :

- `apps/web/src/lib/components/ui/ViewToggle.svelte` — reçoit la liste des vues
  disponibles (`['table','cards','kanban']`), le `view` bindable, rend les boutons-icônes
  avec état actif. Réutilisé par toutes les listes (y compris les existantes, refactor léger).

### Cibles (listes opérationnelles)

Ajout **table + cartes**, et **kanban** quand l'entité a un statut métier :

| Liste | Vues ajoutées | Kanban groupé par |
| --- | --- | --- |
| WMS réceptions | cartes, kanban | statut `Receipt` |
| WMS pick orders | cartes, kanban | statut `PickOrder` |
| WMS cycle counts | cartes, kanban | statut |
| Yard appointments | cartes, kanban | statut `DockAppointment` |
| Yard gate / visits | cartes, kanban | statut `YardVisit` |
| Fleet maintenance orders | cartes, kanban | statut `MaintenanceOrder` |

Les **cartes** réutilisent `Card` + `Badge` (tone selon statut). Le **kanban** réutilise le
pattern de colonnes-par-statut existant (Shipments). Pas de toggle sur les données de
référence.

---

## Chantier 4 — Desk `/apps` = lanceur complet

### Source unique de navigation

Aujourd'hui la nav latérale (`+layout.svelte`), le desk (`/apps`) et la command palette
listent les pages séparément → dérive. On crée un **catalogue unique** côté web :

- `apps/web/src/lib/modules/universe.ts` existe déjà — on en fait (ou on y ajoute) la
  **source de vérité** : pour chaque domaine, la liste de ses pages `{ label, href, icon,
  permission?, module? }`.
- La nav latérale, le desk `/apps` et la command palette **consomment** ce catalogue
  (filtré par permissions + modules activés du tenant). Plus aucune page orpheline.

### Desk

`/apps/+page.svelte` rend une **grille groupée par domaine** (Transport, Entrepôt, Cour,
Assets, Finance, Agents, Connect, Réglages) : chaque domaine = une section avec ses cartes
de pages. **Recherche** filtrant le catalogue en direct. Les pages aujourd'hui absentes
(Control Tower, Finance, Locations, Assets, Audit, Framework…) y figurent.

Condition de fin : toute route sous `(app)/` accessible à l'utilisateur est atteignable
depuis le desk **ou** la nav (audit explicite des routes orphelines).

---

## Chantier 5 — Fluidité

- **Transition de route** : fade/slide court (~150 ms) sur le changement de page dans
  `(app)/+layout.svelte` (transition Svelte sur le slot de contenu, clé = route id).
  Respecte `prefers-reduced-motion`.
- **Skeletons uniformes** : chaque page liste/détail affiche un `Skeleton` pendant son
  `load()` initial (jamais de page blanche). On standardise sur le `Skeleton.svelte`
  existant ; les pages qui n'en ont pas l'adoptent.

---

## Composants touchés / créés

| Fichier | Action |
| --- | --- |
| `lib/components/ui/Modal.svelte` | Enrichi (scrim, focus trap, scroll lock, anim, sizes) |
| `lib/components/ui/Panel.svelte` | **Supprimé** après migration |
| `lib/components/ui/ViewToggle.svelte` | **Créé** (toggle de vues réutilisable) |
| `lib/modules/universe.ts` | Devient catalogue source-unique nav/desk/palette |
| `routes/(app)/+layout.svelte` | Nav depuis catalogue + transition de route |
| `routes/(app)/apps/+page.svelte` | Desk grille groupée + recherche |
| `routes/(app)/fleet/+page.svelte` | Form inline → bouton + Modal |
| `routes/(app)/locations/+page.svelte` | Panel → Modal |
| `routes/(app)/wms/receiving/+page.svelte` + `[id]/` | Liste + page détail dédiée |
| `routes/(app)/wms/picking/+page.svelte` + `[id]/` | Liste + page détail dédiée |
| `routes/(app)/wms/cycle-counts`, `yard/appointments`, `yard/gate`, fleet maintenance | ViewToggle + cartes/kanban |
| `lib/components/ui/CommandPalette.svelte` | Consomme le catalogue |

## Stratégie de test / vérification

- `pnpm typecheck` vert (web inclus).
- Vérification manuelle dans l'app lancée : ouvrir/fermer une modale (anim, scrim, Esc,
  focus, scroll lock), naviguer vers une page détail réception/prélèvement, basculer les
  vues, ouvrir le desk et trouver chaque page, observer la transition de route.
- `grep` : zéro import de `Panel` restant après suppression.
- Aucun test e2e/unit cassé (le travail est purement présentation web).

## Risques / points d'attention

- **Rétro-compat Modal** : les usages WMS actuels de `Modal` ne doivent pas casser pendant
  l'enrichissement → garder l'API de props compatible, migrer en douceur.
- **Focus trap / overlay-stack** : bien réutiliser l'`overlay-stack` existant pour
  l'empilement (modale au-dessus de modale) et le scroll lock par compteur.
- **Catalogue + permissions** : le filtrage par permission/module doit rester identique à
  l'actuel (ne pas exposer une page à un utilisateur sans le droit) — règle de gating
  préservée.
- **`prefers-reduced-motion`** : toutes les animations doivent se désactiver proprement.
