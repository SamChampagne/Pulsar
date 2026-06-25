# Sites Builder — Aperçu live + auto-sauvegarde + UX claire (Cycle 5)

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée — `pulsar-autonomie-execution`)
**Module:** `sites` (web uniquement — backend inchangé)
**Branche:** `crm-email-threads`

## Problème (diagnostic systematic-debugging)

Le backend persiste correctement (`PATCH /sites/pages/:id { content }` vérifié : 200 + round-trip).
**Le bug est UX** : dans `/sites/[id]`, `addBlock()` ne met à jour que l'état en mémoire ; il faut
cliquer « Sauvegarder les blocs » pour persister. Sans ça, les ajouts sont perdus au
reload/navigation → ressenti « j'ajoute mais ça ajoute pas ». De plus, **aucun aperçu** : on ne voit
pas la page qu'on construit.

## Objectif

Rendre le builder fiable et compréhensible : **aperçu live** de la page (WYSIWYG, fidèle au rendu
public) + **auto-sauvegarde** des blocs (plus rien ne se perd) + indicateur d'état + aide inline.

## Décisions de design (auto-arrêtées)

1. **Composant de rendu partagé** `LandingPageRender.svelte` (`$lib/components/sites/`) : rend un
   tableau de blocs (`heading/text/image/form`) exactement comme la page publique. Utilisé par
   **(a)** la page publique `/p/[slug]` (refactor sans changement de comportement) ET **(b)** le
   panneau d'aperçu de l'éditeur. Garantit que l'aperçu = le rendu réel (une seule source de vérité).
2. **Vue scindée** dans `/sites/[id]` : gauche = éditeur de blocs, droite = **aperçu live** qui
   re-rend `blocks` réactivement (aucune sauvegarde requise pour voir).
3. **Auto-sauvegarde des blocs** : toute mutation de bloc (add/remove/reorder/edit) déclenche un
   PATCH `{ content }` **debouncé (~800 ms)**. Indicateur d'état : « Modifié… » → « Enregistrement… »
   → « Enregistré ✓ » (+ horodatage). Bouton « Sauvegarder » manuel conservé (sauvegarde immédiate).
   L'auto-save **ne recharge PAS** la page (pas de `reload()` qui écraserait l'édition en cours) :
   les `blocks` locaux restent la source de vérité ; en cas d'échec, indicateur « Échec — réessayer ».
4. **Champs de page** (titre/slug/captureListId) : **restent en sauvegarde manuelle** (le slug est
   sensible — collision globale possible en cours de frappe). Inchangé.
5. **Aide / onboarding** : un court bloc explicatif (« Ajoutez des blocs à gauche, voyez le résultat
   à droite. Tout est sauvegardé automatiquement. ») + meilleur état vide.

## Architecture

### Composant `LandingPageRender.svelte` (`apps/web/src/lib/components/sites/`)
- Props : `blocks: LandingBlock[]`, `interactive?: boolean` (défaut false). Rend :
  - `heading` → `<h1>` (ou `<h2>` selon position), `text` → paragraphe, `image` → `<img>`,
    `form` → les champs déclarés (en mode aperçu : non soumissible / `interactive=false` désactive le
    submit ; en page publique : `interactive=true` rend le formulaire fonctionnel — MAIS pour garder
    le composant simple et sans dépendance API, il rend uniquement le **markup** des champs ; la
    logique de soumission reste dans `/p/[slug]` autour du composant). Simplest : le composant rend
    l'affichage des blocs (heading/text/image + champs de formulaire en lecture) ; `/p/[slug]` garde
    son `<form>`/submit autour de la liste de champs. Décision : le composant rend heading/text/image,
    et pour `form` il rend les libellés/inputs **désactivés** par défaut ; un slot ou une prop
    `onFormFields` permet à `/p/[slug]` d'injecter ses inputs liés. **Pour éviter la sur-ingénierie :**
    le composant rend heading/text/image ; les blocs `form` sont rendus par le composant en
    **aperçu non-interactif** (inputs `disabled`), et `/p/[slug]` continue de rendre SON propre
    formulaire interactif (il n'utilise le composant que pour heading/text/image, ou rend tout
    lui-même en réutilisant les mêmes styles). On extrait donc surtout le rendu heading/text/image +
    la présentation des champs ; la page publique conserve sa soumission.
- Styles cohérents avec `/p/[slug]` (mêmes classes), pour fidélité de l'aperçu.

### `/sites/[id]/+page.svelte` (refonte de l'éditeur)
- Layout : éditeur (gauche, ~50-60%) + aperçu live (droite, sticky) sur grand écran ; empilé sur mobile.
- Auto-save : un `$effect` debouncé observe `blocks` ; après un changement (et hors chargement
  initial), PATCH `{ content }`. Garde un drapeau `dirty`/`saveState` (`idle|dirty|saving|saved|error`).
  Ne déclenche pas au premier render (garde-fou via un flag « hydraté »).
- Indicateur d'état visible près des blocs (« Enregistré ✓ il y a Xs » / « Enregistrement… » / « Modifié »).
- Aperçu = `<LandingPageRender blocks={blocks} />` (re-rend à chaque frappe).
- Aide inline + état vide amélioré.
- Le bouton « Publier » reste ; `disabled` si 0 bloc (inchangé). La sauvegarde des champs reste manuelle.

### `/p/[slug]/+page.svelte` (refactor)
- Réutilise `LandingPageRender` pour heading/text/image (et la présentation des champs), en gardant
  son `<form>` + submit + honeypot autour. Aucun changement de comportement public (mêmes endpoints,
  même honeypot, même message de succès). Vérifier que `/p/bienvenue` rend toujours pareil.

## Conformité hard rules
- Aucun changement backend (le PATCH content/validation reste tel quel). R10 (page publique) inchangé.
- Web : idiomes Svelte 5 runes, `api<T>()`, débounce sans dépendance externe (timeout maison).

## Tests
- **Web unit (Vitest, si l'infra `apps/web` le permet — cf. mémoire)** : un test du composant
  `LandingPageRender` (rend heading/text/image/form) si trivial ; sinon s'appuyer sur build+typecheck.
- **Vérification manuelle** (app en cours) : `/sites/[id]` — ajouter un bloc → apparaît dans l'aperçu
  → après ~1 s, indicateur « Enregistré » → recharger la page → le bloc est toujours là (plus de perte).
  `/p/bienvenue` rend identique après refactor.
- `pnpm --filter @pulsar/web build` + `pnpm typecheck` verts.

## Hors périmètre v1
- WYSIWYG drag-drop in-place, édition inline dans l'aperçu, thèmes, undo/redo, autosave des champs
  (slug/titre). Nouveaux types de blocs.
