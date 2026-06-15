# Dispatch Workbench v1 — Design

> Statut : approuvé (brainstorm 2026-06-15). **Pivot produit** décidé avec Sam : le gap principal
> de Pulsar n'est plus « plus de features » mais la **tool experience** — l'app se présente comme
> une admin SaaS (navbar → page → Card → Table → Form → Modal) au lieu de vrais postes de travail
> opérationnels (cf. diagnostic Hermes/Lebron + benchmark Fleetbase). Première surface profonde :
> le **Dispatch Workbench**. Les agents sont l'augmentation, pas la substance — l'agent viendra
> comme un panneau dans une tranche ultérieure.

## Objectif

Remplacer le triptyque de pages séparées (orders / shipments / loads) par **un poste de travail de
planification unique** où l'opérateur consolide des shipments en loads, voit la capacité / la
route / le coût / les rates **in-context**, et tender — sans jamais quitter l'écran. Plus un
**assainissement de la navigation** (la structure est saine mais les groupes repliés par défaut
cachent l'app).

## Contexte vérifié (live, ce jour)

- L'app phases 11→16 boote ; pilotage navigateur opérationnel (login admin@pulsar.dev / acme).
- **Nav** (`apps/web/src/routes/(app)/+layout.svelte`) : tout est câblé (aucune page orpheline),
  MAIS `openGroups` démarre vide → au login on ne voit que Dashboard / Agent actions / Workbench /
  Agents + 6 groupes **repliés**. Surfaces agent éparpillées (`/agents`, `/agent-actions`,
  `/workbench`, `/settings/agents` ≈ doublon de `/agents`, `/settings/agent-runtime`).
- **Endpoints réutilisables** (rien à reconstruire) : `GET /shipments` (liste paginée avec O→D,
  fenêtres, poids/volume/palettes, `load`), `shipments assignToLoad` (capacité 3 axes + `force`),
  `GET /loads/:id` (route/stops/cost snapshot/tenders/ressources), rate shopping (`rate_options`),
  `tenders create`, carrier scorecard, génération de route. `Load.estimatedCost`/`costDetail`
  figés (règle 16). Composant carte existant (page load / OpsMap, géométrie display-only phase 10).

## Décisions verrouillées (brainstorm)

1. **Première tranche = 3 panneaux, assignation au clic** (pas de drag/drop, pas d'agent).
2. **Page `/dispatch` dédiée** ; les pages existantes restent (listes/admin).
3. **Backend minimal** : 1 filtre + 1 endpoint atomique ; aucune migration ; aucune nouvelle
   permission (réutilise `transportation.planning.read|manage`).
4. **Carte + rates + tender inclus** dès la v1.
5. **Polish nav/shell fondue dans cette phase** : groupes dépliés par défaut, entrée Dispatch
   proéminente, consolidation des liens agent.
6. **Vérification navigateur dans la definition-of-done** : chaque tranche UI est inspectée dans le
   navigateur (chrome-devtools) avant d'être déclarée finie — pas seulement build/typecheck.

## Architecture

### A. Shell de navigation (polish)
- `+layout.svelte` : initialiser `openGroups` pour que **tous les groupes visibles soient ouverts
  par défaut** (et persister l'état ouvert/fermé en `localStorage` pour respecter le choix de
  l'utilisateur). Effet immédiat : l'app ne « semble » plus vide.
- Ajouter une entrée **« Dispatch »** en haut de la nav (sous Dashboard), gated `hasTransportation`,
  badge optionnel (nb de shipments non planifiés).
- **Consolidation agent** (léger) : retirer le lien `/settings/agents` (doublon de l'espace
  `/agents` de premier ordre) — garder la page accessible par URL si besoin mais hors nav ; laisser
  `/settings/agent-runtime` (config runtime, distinct). `agent-actions` + `workbench` restent
  (inbox d'approbations + tâches). *Pas de refonte de la nav au-delà de ça.*

### B. Page `/dispatch` — layout 3 colonnes
Grille plein-écran `grid-cols-[28%_minmax(0,1fr)_32%]` (responsive : empilée/onglets sous `lg`).
Composée de 3 composants isolés + 1 conteneur d'état :
- `DispatchBacklog.svelte` (gauche), `LoadBuilder.svelte` (centre), `DispatchSidePanel.svelte`
  (droite : carte + rates + carrier + tender). Conteneur `+page.svelte` détient l'état partagé.

### C. Panneau gauche — Backlog (`DispatchBacklog`)
Shipments **planifiables non assignés** : `GET /shipments?unassigned=true` (j'ajoute le filtre
`unassigned` côté API s'il manque — `loadId: null` + statut planifiable). Affiche n°, order, O→D,
fenêtre pickup/livraison, kg/m³/palettes, indice de retard (fenêtre dépassée). **Multi-sélection**
(cases) → drive le centre. Recherche texte + filtre région/mode minimal.

### D. Panneau centre — Load builder (`LoadBuilder`)
- **Sélection sans load** → bouton « Consolider en load » : `POST /loads/consolidate { shipmentIds }`
  (nouvel endpoint atomique — crée le load + assigne tous les shipments en une transaction, via les
  services existants : `LoadCostService.recompute` + `checkCapacity` + invariant `shipment_load_legs`,
  règle 18). Évite le load à moitié construit d'une orchestration client en N appels.
- **Load sélectionné** (clic depuis un picker de loads OUVERTS, ou après consolidation) → affiche :
  shipments assignés ; **barres de capacité 3 axes** (poids/volume/palettes, rouge si dépassement,
  données `checkCapacity`) ; **timeline des stops** (pickups puis livraisons, heures planifiées) ;
  **coût estimé** (snapshot `costDetail`, jamais recalculé — règle 16). Actions : « Ajouter la
  sélection » (`assignToLoad` avec retour capacité + `force`), retirer un shipment, (re)générer la
  route.

### E. Panneau droit — Carte + Rates/Carrier (`DispatchSidePanel`)
- **Carte** : route + stops du load sélectionné (réutilise le composant carte existant ;
  géométrie display-only). Vide tant qu'aucun load.
- **Rate options** : rate shopping du load (classé par spécificité, fuel/accessorials, « pourquoi
  ce rate gagne »). Sélection d'un rate/carrier.
- **Carrier scorecard** du candidat (on-time %, taux d'acceptation, dépense).
- **Tender** : tender le load au carrier choisi (flux existant) → PLANNED→TENDERED.

### F. État & flux (frontend)
`+page.svelte` détient : `backlog` (liste), `selectedShipmentIds` (`Set`), `selectedLoad` (id +
détail chargé), capacité/coût dérivés. `$effect` recharge le détail du load + le backlog après
assign/consolidate/tender. Tout via le client `api<T>()`. Erreurs en `toast` (pattern existant).

### G. Backend (minimal, pas de migration)
1. **Filtre `unassigned`** sur `GET /shipments` (si absent) — `loadId: null` + statuts planifiables,
   tenant-scopé.
2. **`POST /loads/consolidate { shipmentIds }`** — controller loads, `@RequireModule(TRANSPORTATION)`
   + `planning.manage` ; transactionnel ; valide l'appartenance (rule 9 `assertOwned`), crée le load
   (numéro via `SequencesService`, règle 8), assigne chaque shipment (capacité au niveau warning,
   `shipment_load_legs` même transaction — règle 18), recompute le coût (règle 11). Audité (règle 6).
   Retourne le load complet.
Tout le reste réutilise l'existant.

### H. La *craft* front (le point de la phase)
On casse le moule admin : surface dense mono-écran ; barres de capacité qui virent au rouge en
direct ; carte + rates in-context ; navigation clavier raisonnable ; états vides explicites
(« sélectionnez des shipments pour construire un load »). Implémentation avec le skill
`frontend-design` (UI distinctive). Tokens du design system réutilisés, mais **vraie nouvelle
composition** — pas `PageHeader + Card + Table`.

## Definition of Done (par tranche UI)
Build web propre + `typecheck` 0 erreur + e2e backend du neuf vert + **inspection navigateur**
(chrome-devtools : login, ouvrir `/dispatch`, vérifier les 3 panneaux rendent, sélectionner des
shipments, consolider, voir capacité/route/cost/rates, capture). Pas seulement « ça compile ».

## Tests
- E2e backend : filtre `unassigned` (ne renvoie que les non assignés du tenant) ; `consolidate`
  (atomique — crée le load + assigne ; capacité respectée ; ownership/tenant ; `shipment_load_legs`
  maintenu ; rollback si une assignation échoue).
- Web : build + typecheck ; **inspection navigateur** du parcours complet (DoD ci-dessus).
- (Pas de test unitaire front établi dans le repo — cohérent avec les phases précédentes.)

## Hors périmètre (tranches / cycles suivants)
- **Drag & drop** (backlog→builder, réordonnancement stops) → workbench v2.
- **Panneau agent** (« Hermes optimise cette tournée » → `ProposedAction`) → tranche ultérieure.
- **Positions camion live** → tracking, pas planif.
- **Autres workbenches** : Load Control Room, Agent Operations Center, Exception Desk, Rate
  Explorer, Workflow Config Designer → cycles séparés (un par phase).
- Refonte complète de la nav / du dashboard → au-delà du polish ci-dessus.
