# CRM Intelligence — Kanban refait + Coach de deals (Cycle 1)

**Date:** 2026-06-24
**Statut:** approuvé (design), prêt pour plan
**Module:** CRM (`MODULE_KEYS.CRM`) + core/agents (réutilisé)
**Branche:** `crm-email-threads` (travail CRM groupé)

## Objectif

Donner au CRM l'effet « cockpit intelligent » à la Attio : (A) un **kanban de pipeline refait**
— riche, drag-drop, avec signaux — et (B) un **coach de deals** : une page de chat où un agent
analyse les deals et propose comment les gagner, en réutilisant l'infra agents/conversations
existante.

Premier des cycles d'une trajectoire plus large (voir « Suite » en bas) : produits → commandes
→ connecteurs/marketing. Ce cycle ne touche ni produits ni commandes.

## Décisions arrêtées (brainstorming)

1. **Moteur du coach** : agent **Hermes complet** (tool-calling + gouvernance), pas un LLM direct.
   Réutilise `agent-conversations` (start + SSE par tour) et la file `ProposedAction`.
2. **Kanban** : board riche + **drag-drop HTML5 natif** (zéro dépendance) + signaux (stale/âge).
3. Le coach est **turnkey** : un preset de rôle `deal-coach` ; l'agent est provisionné en 1 clic
   pour le tenant s'il n'existe pas.

## A. Kanban refait (`apps/web/.../crm/pipeline/+page.svelte`)

- **Données** : réutilise `GET /crm/pipeline` (déjà groupé par stage avec `companyName`, `amount`,
  `owner`, `lastActivityAt`). Enrichi côté API d'un `ageDays` et d'un flag `stale` (open + pas
  d'activité depuis >7j, ou pas d'activité + créé il y a >7j — **même logique que
  `OverviewService.staleDealCount`**, à factoriser dans un helper partagé `isDealStale` côté API
  pour ne pas diverger). Les deals fermés (WON/LOST) ne sont jamais `stale`.
- **Colonnes** LEAD │ QUALIFIED │ PROPOSAL │ WON │ LOST. En-tête de colonne : **count + Σ montant**
  (devise du tenant ; pondération optionnelle hors périmètre v1).
- **Cartes riches** : titre, company, montant formaté, âge (`ageDays`), badge **⚠ stale**, owner,
  bouton **🧠 Coach** (→ `/crm/coach?dealId=<id>`), clic sur la carte → fiche deal `/crm/deals`
  (ou détail existant).
- **Drag-drop** : déposer une carte dans une autre colonne → `POST /crm/deals/:id/advance {stage}`.
  - Respecte le state machine (`canTransitionDeal`) : WON/LOST sont **terminaux** → si la cible est
    invalide, refus visuel + toast, **aucune** requête (ou revert si le serveur refuse 400).
  - **Update optimiste** : la carte bouge tout de suite ; en cas d'échec API, **revert** + toast.
  - `convert` (WON → Customer) reste une action séparée sur la fiche deal — pas via drag.
- Pattern web standard (Svelte 5 runes, `$state`/`$effect`, `api<T>()`, erreur locale). Le board
  reste lisible sur petit écran (colonnes scrollables horizontalement).

## B. Coach de deals

### Preset de rôle (`packages/shared/src/agents/role-presets.ts`)
- Nouveau preset **`deal-coach`** (pure data, browser-safe — rule 26) : persona orientée
  « analyse un deal/pipeline, identifie risques et leviers, propose la prochaine meilleure
  action et un plan pour gagner ; agis via les outils CRM (relance, note, avancement) ».
  Permissions `crm.read` + `crm.manage`, module `crm`, `alwaysOn: false`. Mirroir du style des
  presets existants (`crm-sdr`, `analyst`).

### Outil agent `crm_get_deal` (READ)
- Nouvel outil dans le registre (`core/agents/tools/crm.tools.ts`, rule 21), tier **READ**,
  `PERMISSIONS.CRM.READ`, `MODULE_KEYS.CRM` : retourne **un deal + sa company + ses contacts +
  ses activités** (pour analyse fine d'un deal précis). Délègue à un service CRM existant
  (`DealsService.get` enrichi, ou un getter dédié). Ajouté à `tool-types.ts` (`crm.getDeal`) +
  adaptateur `agents.module.ts`. Exécution directe (READ).

### Page `/crm/coach/+page.svelte`
- **Résolution turnkey de l'agent coach** : au chargement, appelle un nouvel endpoint
  `GET /crm/coach/agent` qui renvoie l'agent `deal-coach` du tenant (projection sans
  `secretHash`/`serviceUserId` — rule 26) ou `null`. Si `null`, bouton **« Activer le coach »**
  → `POST /crm/coach/agent` qui crée l'agent depuis le preset `deal-coach` via le service agents
  existant (réutilise la création depuis preset ; aucune logique de création dupliquée). Ces deux
  endpoints vivent dans le module CRM, gated `@RequireModule(CRM)` + `crm.read`/`crm.manage`,
  tenant-scopés (rule 1).
- **Chat** : réutilise l'API `agent-conversations` existante —
  `POST /agent-conversations {agentId}` pour démarrer, `POST /agent-conversations/:id/messages
  {text}` (SSE) par tour. La page :
  - **Mode deal** (ouvert avec `?dealId=`) : le premier tour injecte automatiquement
    « Analyse le deal `<id>` et explique comment le gagner : risques, leviers, prochaine action. »
    L'agent tire le contexte via `crm_get_deal`/`crm_get_company`/`crm_list_activities`.
  - **Mode pipeline** (sans `dealId`) : prompts suggérés (« Quels deals sont à risque ? »,
    « Où concentrer mes efforts ce mois-ci ? »).
  - Affiche le **stream** (texte + appels d'outils résumés « a consulté le deal X ») et les
    **actions proposées inline** (relance/avancement) avec bouton **Approuver** branché sur le
    flux `ProposedAction` existant (`POST /proposed-actions/:id/approve` ou l'endpoint en place).
  - Prompts suggérés cliquables ; champ de saisie libre.
- **Navigation** : entrée « Coach » dans la section CRM du layout (gated `crm.read`).
- **Dépendance runtime** : exige le runtime Hermes configuré par tenant. Indisponible ⇒ l'API
  renvoie 503 (best-effort, jamais de crash — rule 24) et la page affiche « Configure le runtime
  d'agent dans /agents » avec un lien. La boucle LLM se valide à la main/démo.

## Gouvernance & conformité aux hard rules

- Le coach est un agent **normal** : outils READ en direct ; toute mutation (`crm_log_activity`,
  `crm_advance_deal`, `crm_create_followup`) passe par la file **`ProposedAction`** (rules 22/29),
  caps appliqués. **Rien de neuf** côté moteur de gouvernance.
- R1 tenant isolation sur tous les endpoints (pipeline enrichi, coach/agent, get_deal).
- R21 outils via le registre ; R26 projection agent sans `secretHash`/`serviceUserId`.
- R2 : l'avancement de stage (drag-drop et coach) passe TOUJOURS par `advance` →
  `canTransitionDeal` (jamais d'`update({ stage })` direct).

## Tests

- **Unit (`@pulsar/shared`)** : forme du preset `deal-coach` (étend `role-presets.spec.ts` :
  permissions non vides, module valide). Helper `isDealStale` pur si extrait dans shared.
- **e2e (`apps/api/test`)** : `crm_get_deal` renvoie deal+company+activités tenant-scopé ;
  `GET /crm/coach/agent` (null puis non-null après `POST`), provisioning depuis preset **sans
  exiger Hermes vivant** ; `GET /crm/pipeline` renvoie `ageDays`/`stale`. La boucle de chat
  (Hermes) n'est PAS testée en CI (manuel/démo).

## Hors périmètre v1 (backlog)

- Pondération du pipeline par probabilité de stage, prévisions.
- Coach proactif (suggestions non sollicitées, déjà couvert ailleurs par les exceptions CRM).
- Login OAuth « Se connecter avec Google » pour le courriel (Cycle 2).

## Suite (roadmap, hors de ce cycle — pour mémoire)

Trajectoire validée avec Sam, à dérouler en cycles successifs (spec→plan→subagents chacun) :
1. **Produits** : catalogue + lignes de produit sur les deals (montant calculé, devis) → alimente
   Billing. **Socle du reste.**
2. **Commandes de vente** : sur les produits (deal gagné → commande → fulfillment → facture) ;
   nommage à clarifier vs transport orders / factures existants.
3. **Connecteurs** (Shopify → commandes, via la couche `connect/inbound` existante) +
   **email marketing approfondi** (séquences, segments, stats).
4. **Modules dédiés plus tard** : social (par réseau, OAuth, 1-2 réseaux d'abord) ; **builder de
   landing pages** intégré au CRM (capture de leads) — **PAS** d'hébergement type cPanel
   (métier infra/devops distinct, mauvais ROI, surface sécurité énorme).
