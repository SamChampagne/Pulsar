# Pulsar LSOS — Architecture d'information & roadmap des outils opérationnels

> Document architecte système + product manager. Objectif : faire passer Pulsar de
> « SaaS modulaire avec des menus » à **système d'exploitation métier (LSOS)** où chaque
> module a une mission, un accueil, des postes de travail profonds, des registres, des pages
> détail, une configuration, des KPI, des files de travail et un **agent IA contextualisé**.
>
> Principe directeur : **le bon choix n'est pas « moins de pages », c'est « plus de pages, mais
> avec une architecture claire et des outils profonds »**. Une page n'est pas mauvaise parce
> qu'elle est nombreuse — elle est mauvaise si son **rôle** est flou.
>
> À lire avec : [ui-page-standard.md](./ui-page-standard.md) · [module-system.md](./module-system.md)
> · [etat-du-projet.md](./etat-du-projet.md). Invariants : [AGENTS.md](../AGENTS.md).

---

## 0. Vocabulaire des rôles de page

Chaque page de Pulsar DOIT avoir exactement un rôle. C'est la règle qui permet d'ajouter
beaucoup de pages sans menu chaotique.

| Rôle | Définition | Question utilisateur | Exemple |
| ---- | ---------- | -------------------- | ------- |
| **Accueil module** (Hub) | Mission + KPI + files de travail + raccourcis + agent du module | « Où suis-je ? Qu'est-ce qui demande mon attention ? » | `/finance`, `/wms`, `/assets` |
| **Poste de travail** (Workbench/Cockpit) | Surface dense où l'opérateur agit sans quitter l'écran (multi-panneaux, carte, board, timeline, inspecteur) | « Quel outil j'utilise pour agir ? » | `/dispatch`, `/yard`, `/manufacturing/scheduling` |
| **Registre** (Registry) | Liste paginée filtrable d'objets métier ; porte d'entrée vers les détails | « Quel registre contient les objets ? » | `/loads`, `/shipments`, `/crm/companies` |
| **Détail** (Detail) | Un objet, son cycle de vie, ses actions, son audit, ses pièces | « Quelle preuve/audit soutient l'action ? » | `/loads/[id]`, `/crm/deals/[id]` |
| **Analyse** (Control Tower) | KPI, tendances, scorecards, flux causaux | « Est-ce que ça va bien globalement ? » | `/analytics/*`, `/control-tower` |
| **Configuration** | Réglages de processus + champs personnalisés du module | « Comment j'adapte le module à mon entreprise ? » | `/billing/config`, `/transportation/config` |

**Squelette canonique d'un module** (ordre de la navigation) :

```
Module
 ├─ Accueil          (1 hub)
 ├─ Postes de travail (N cockpits/workbenches — le cœur opérationnel)
 ├─ Registres        (N listes → détails)
 ├─ Analyse          (0–N control towers)
 └─ Configuration    (1 config)
```

---

## 1. Audit de l'architecture d'information actuelle

**État réel (2026-06-29)** : ~110 pages app, 13 domaines de navigation, 6 modules métier actifs
+ CRM + Sites + Manufacturing/APS + cœur plateforme. La nav est **déjà** organisée en
domaines→sections→liens avec des homes de module et un « Pulsar Desk » (`/apps`). La maturité
est élevée ; le problème n'est pas l'absence de structure mais son **incohérence** et le
**manque de profondeur** sur plusieurs modules.

### Constats forts

1. **Structure de sections incohérente entre modules.** Transport a `Exécution / Tarification /
   Partenaires / Administration` ; Finance est une **liste plate de 9 liens** sans hiérarchie ;
   WMS a `Flux / Données / Administration` ; Fleet mélange `/assets` et `/fleet`. Aucun module
   ne suit le même squelette → charge cognitive à chaque changement de domaine.

2. **Doublons / surfaces ambiguës.**
   - Agents apparaît dans son domaine **et** dans Connect (`MCP / agents`).
   - `/settings/agents` ET `/agents` (réglages vs roster) — déjà partiellement dé-doublonné.
   - `/control-tower` (agents) ET `/analytics/control-tower` (ops) — deux « Control Tower »
     qui ne sont pas le même objet.
   - `/settings/api-keys` listé dans Connect **et** Settings.
   - Fleet : `/assets` (home) et `/fleet` (roster) — frontière floue.

3. **Modules « plats » sans profondeur opérationnelle.**
   - **Finance** : 9 liens en liste, pas de cockpit ROI/recouvrement, freight-audit est une
     liste pas un workbench, pas de Dispute Desk, pas de Cash/Recovery dashboard.
   - **WMS** : overview + workbenches existent mais **pas de Flow Board** unifié.
   - **Yard** : plan + gate, mais **pas de Dock Scheduler ni Dwell/Detention Desk**.
   - **Fleet** : roster + maintenance, mais **pas de Control Room ni Compliance Desk ni Asset
     Availability**.
   - **Transport** : Dispatch existe (✅ poste profond), mais **pas de Load Control Room ni
     Exception Desk**.

4. **Agents pas assez présents dans les outils métier.** Les agents vivent surtout dans `/agents`
   et `/control-tower`. Le coach CRM (`/crm/coach`) est le seul vrai agent **contextualisé dans
   un module**. Dispatch, Finance, WMS, Yard n'ont pas de panneau agent in-situ.

5. **Langage produit partiellement appliqué.** « Billing » → Finance ✅, « Fleet » → Assets ✅,
   mais des libellés internes subsistent (« Receivables / Payables », « MCP / agents »,
   « Grand livre » vs « Ledger »). Mélange FR/EN à plусieurs endroits.

### Tableau de classification des pages existantes

| Page | Rôle actuel | Verdict |
| ---- | ----------- | ------- |
| `/apps`, `/dashboard` | Hub plateforme | **Garder** (clarifier Desk vs Dashboard) |
| `/dispatch` | Poste profond | **Garder** (référence) |
| `/planning` | Poste (board) | **Garder + approfondir** (drag/drop) |
| `/rate-studio` | Poste (tarification) | **Garder + rendre visuel** (P1) |
| `/transport-orders`, `/shipments`, `/loads`, `/lanes`, `/rates`, `/accessorials`, `/fuel-tables`, `/customers`, `/carriers`, `/locations` | Registres | **Garder** (appliquer ui-page-standard) |
| `/loads/[id]`, `/transport-orders/[id]`, `/carriers/[id]`, `/customers/[id]` | Détails | **Garder** |
| `/finance` | Hub (faible) | **Approfondir → cockpit ROI** (P0) |
| `/invoices` | Registre | **Garder + renommer** (AR/AP clair) |
| `/billing/freight-audit` | Registre | **Approfondir → Freight Audit Workbench** (P1) |
| `/billing/ledger`, `/reports`, `/banking`, `/budgets`, `/fixed-assets`, `/subscriptions`, `/payments` | Registres/outils | **Garder** (regrouper en sections) |
| `/wms` | Hub | **Garder + Flow Board** (P1) |
| `/wms/receiving`, `/fulfillment`, `/picking`, `/cycle-counts`, `/inventory` | Postes/registres | **Garder** |
| `/wms/items`, `/bins` | Registres | **Garder** |
| `/yard` | Poste (plan) | **Garder** (référence visuelle) |
| `/yard/gate`, `/appointments`, `/spots` | Postes/registres | **Garder + Dock Scheduler/Dwell** (P1) |
| `/assets` + `/fleet` | Hub + roster | **Fusionner sous un home Fleet clair** (P0 nav) |
| `/fleet/maintenance` | Poste | **Garder + Control Room/Compliance Desk** (P1) |
| `/agents`, `/agents/[id]`, `/agent-actions`, `/workbench`, `/control-tower`, `/automation`, `/settings/agent-runtime` | Postes/hub agents | **Garder + regrouper en Agent Operations Center** |
| `/analytics`, `/control-tower` (analytics), `/scorecards`, `/flow`, `/carriers` | Analyse | **Garder + clarifier vs Control Tower agents** |
| `/crm/*` | Hub/registres/postes | **Garder** (déjà mûr) |
| `/manufacturing/*` | Hub/poste(Gantt)/registres | **Garder + Planning Runs** (P1) |
| `/connect`, `/connect/inbox`, `/imports`, `/integrations`, `/settings/api-keys` | Hub/postes | **Approfondir → Connect Studio** (P0 direction, P1 build) |
| `/sites`, `/sites/[id]` | Registre/détail | **Garder** |
| `/procurement/*` | Registres | **Garder** |
| `/documents`, `/emails/*`, `/personalize`, `/settings/*` | Cœur | **Garder** |
| `/settings/agents` | Config (doublon) | **Fusionner dans `/agents/[id]`** |
| `/framework` | Démo interne | **Faible utilité — masquer de la nav** |

**Synthèse :**
- **Garder tel quel** : ~70 pages (registres, détails, postes existants, cœur).
- **Approfondir** : Finance (cockpit), Freight Audit (workbench), WMS (Flow Board), Yard (Dock
  Scheduler/Dwell), Fleet (Control Room/Compliance), Connect (Studio), Rate Studio (visuel).
- **Fusionner** : `/assets`+`/fleet` (home unique), `/settings/agents`→`/agents/[id]`,
  les deux occurrences d'API keys et d'Agents (une source canonique + raccourci).
- **Mal positionnées** : `/framework` (démo, hors nav), `/automation` (sous Agents OK mais à
  étiqueter « Automatisations »), Agents dupliqué dans Connect (garder un simple raccourci).

---

## 2. Carte de navigation cible

13 domaines, **squelette identique partout** : Accueil → Postes de travail → Registres →
Analyse → Configuration. Les libellés visibles sont en **langage produit** (clé backend
inchangée).

### Transport / Operations  (`transportation`)
- **Accueil** : Accueil Transport (mission, KPI on-time/loads ouverts/exceptions, files, agent dispatcher)
- **Postes** : Dispatch Cockpit · **Load Control Room** 🆕 · **Exception Desk** 🆕 · Planning Board · Rate Studio
- **Registres** : Ordres de transport · Shipments · Loads · Lanes · Rates · Accessoriaux · Carburant · Clients · Transporteurs · Lieux
- **Analyse** : Scorecard transporteurs · On-time
- **Configuration** : Réglages Transport + champs personnalisés

### Finance / Ledger  (`billing`)
- **Accueil** : **Finance Cockpit** 🆕 (ROI : économies freight audit récupérées, AR/AP aging, cash, litiges ouverts, agent finance)
- **Postes** : **Freight Audit Workbench** 🆕 · **Dispute Desk** 🆕 · **Cash / Recovery** 🆕 · Grand livre · Banque & rapprochement
- **Registres** : Relevés clients (AR) · Factures transporteur (AP) · Paiements · Budgets · Immobilisations · Abonnements
- **Analyse** : Rapports financiers (P&L, bilan, cash-flow, aging)
- **Configuration** : Réglages Finance + champs personnalisés + exercice fiscal

### Warehouse / Inventory  (`wms`)
- **Accueil** : Accueil Warehouse (stock total, bins négatifs, réceptions/picks ouverts, agent entrepôt)
- **Postes** : **Warehouse Flow Board** 🆕 · Receiving Workbench · Fulfillment / Staging · Picking Workbench · Inventory Control · Cycle Counts
- **Registres** : Articles · Emplacements (bins)
- **Configuration** : Réglages WMS

### Yard / Dock  (`yard`)
- **Accueil** : Accueil Yard (occupation, à placer, RDV du jour, séjours longs, agent cour)
- **Postes** : Yard Plan · Gate Console · **Dock Scheduler** 🆕 · **Dwell / Detention Desk** 🆕
- **Registres** : Rendez-vous · Spots
- **Configuration** : Réglages Yard

### Assets / Fleet  (`fleet`)
- **Accueil** : Accueil Fleet (assets prêts vs maintenance, conformité expirante, WO ouverts, agent flotte)
- **Postes** : **Fleet Control Room** 🆕 · Maintenance Board · **Compliance Desk** 🆕 · **Asset Availability** 🆕
- **Registres** : Véhicules · Remorques · Chauffeurs
- **Configuration** : Réglages Fleet

### Connect / Developer Platform  (core integrations)
- **Accueil** : Connect home (systèmes branchés, flux manquants)
- **Postes** : **Connect Studio** 🆕 (canvas de flux) · Inbox · Imports · **Mapping Workbench** 🆕
- **Registres** : Connecteurs · Clés API · Webhooks · MCP Tools
- **Configuration** : Réglages Connect

### AI Workforce  (`agents`, core)
- **Accueil** : Accueil Agents (roster d'employés)
- **Postes** : **Agent Operations Center** 🆕 (santé, runs 24/7, breaker) · Proposed Actions · Workbench Tasks · Automatisations
- **Analyse** : Control Tower agents (KPI, trust score, timeline)
- **Détail** : Agent Detail (profil, config, activité, chat)
- **Configuration** : Runtime / connexion modèle · Policy / Autonomie

### Manufacturing / APS  (`manufacturing`)
- **Accueil** : Accueil Manufacturing (OF par statut, charge des postes, agent planificateur)
- **Postes** : Scheduling Gantt · **Planning Runs** 🆕
- **Registres** : Ordres de fabrication · Postes de charge · Gammes · Nomenclatures · Calendriers
- **Configuration** : Réglages Manufacturing

### CRM / Commerce  (`crm`)  — déjà mûr, on aligne les sections
- **Accueil** : Tableau de bord CRM · **Postes** : Pipeline (kanban) · Coach de deals · Inbox
- **Registres** : Deals · Sociétés · Contacts · Activités · Produits · Commandes de vente · Listes · Campagnes
- **Configuration** : Réglages CRM

### Analytics / Network  (`analytics`)
- **Accueil** : Vue d'ensemble · **Postes** : Control Tower de flux (timeline/trace/map)
- **Analyse** : Scorecards · Scorecard transporteurs

### Sites & Pages · Procurement · Documents · Emails · Réglages · Personnalisation
- Conservés ; sections alignées sur le squelette quand pertinent.

🆕 = nouvelle surface à créer (voir §5).

---

## 3. Roadmap produit/UX par phases

| Phase | Thème | Contenu | État |
| ----- | ----- | ------- | ---- |
| **0** | Audit | Cartographie + classification (ce document) | ✅ ce doc |
| **1** | Architecture d'information | Refonte `navigation.ts` au squelette canonique, langage produit, dé-doublonnage | **P0 — cette session** |
| **2** | Structure cible par module | Accueils renforcés + 1er lot de postes profonds | P0/P1 |
| **3** | P0 vendabilité | Nav claire · accueils · **Load Control Room** · **Finance cockpit** · agent contextuel Dispatch+Finance · direction Connect Studio | **cette session** (cœur) |
| **4** | P1 profondeur métier | WMS Flow Board · Fleet Control Room · Dock Scheduler/Dwell · Exception Desk cross-module · Agent Operations Center · Rate Studio visuel · Manufacturing Gantt enrichi | roadmap |
| **5** | P2 expansion avancée | Continuous Planning · Workflow Config Designer · réseau de données/benchmark · OR-Tools/VROOM · ingestion EDI/email/PDF · agents spécialisés par module | roadmap |

---

## 4. Justification architecte système + PM (par choix structurant)

1. **Squelette canonique unique (Accueil→Postes→Registres→Analyse→Config).**
   *PM* : l'utilisateur apprend la grammaire une fois et la rejoue dans 13 modules → onboarding
   et démos plus rapides, perception « OS » plutôt que « collection d'apps ».
   *Architecte* : `navigation.ts` reste la **source de vérité unique** (déjà le cas) ; on
   n'ajoute aucune dépendance ; l'expansion = ajouter une entrée de section, pas réinventer un menu.

2. **Postes de travail profonds plutôt que pages-formulaires.**
   *PM* : c'est le différenciateur vs ERPNext/Fleetbase et la demande explicite (« outils, pas
   formulaires »). Un cockpit où l'opérateur ne quitte pas l'écran = valeur démontrable.
   *Architecte* : les cockpits **réutilisent les services et endpoints existants** (règle :
   pas de nouvelle frontière de module) ; ils composent des données déjà exposées (loads,
   active-map, costDetail, reports) sans nouveau store.

3. **Agent IA présent dans les outils métier, pas seulement dans `/agents`.**
   *PM* : la promesse « employés IA » ne se voit que si l'agent est là où on travaille
   (Dispatch, Finance). Le coach CRM prouve le pattern.
   *Architecte* : un **composant panneau agent réutilisable** (chat SSE vers Hermes + actions
   `ProposedAction` approuvables inline) ; gouvernance inchangée (règles 22–29), best-effort
   (Hermes absent ⇒ message, jamais de crash). Aucune nouvelle voie d'exécution.

4. **Dé-doublonnage par « source canonique + raccourci ».**
   *PM* : une seule page « vraie » par concept évite la confusion ; les raccourcis croisés
   (Agents depuis Connect) restent utiles sans dupliquer le contenu.
   *Architecte* : moins de surfaces à maintenir, pas de divergence de comportement.

5. **Lecture-temps-réel plutôt que rollups.**
   *Architecte* : les cockpits/accueils calculent KPI **à la lecture** depuis les sources
   (`AgentRun`, `JournalLine`, `Load`, `OperationalTask`) — cohérent avec les invariants
   existants (Control Tower, rapports, flow). **Zéro migration** pour la couche IA/UX.

---

## 5. Nouveaux outils/pages à créer par module

> Légende priorité : **P0** (vendabilité rapide, cette session) · **P1** (profondeur) · **P2** (avancé).

### Transport
- **Load Control Room** `/loads/control-room` — **P0**. Salle de contrôle des loads en vol :
  carte live (réutilise `GET /loads/active-map`), colonnes par statut (PLANNED→DISPATCHED→IN_TRANSIT→
  COMPLETED), bannière exceptions (retards via le moteur d'exceptions), coût figé, tender. Panneau
  agent dispatcher contextuel. *Réutilise* loads + active-map + exceptions + costDetail.
- **Exception Desk** `/transportation/exceptions` — **P1**. File des `OperationalTask` filtrées
  transport, triage, résolution, escalade agent.

### Finance
- **Finance Cockpit** `/finance` (refonte) — **P0**. ROI : `recoveredAmount` (économies freight
  audit), AR/AP aging (réutilise `GET /billing/reports/{ar,ap}-aging`), cash, litiges ouverts,
  relevés à envoyer. Agent finance contextuel. *Réutilise* reports + freight-audit + invoices.
- **Freight Audit Workbench** `/billing/freight-audit` (refonte) — **P1**. Inspecteur ligne à
  ligne : facture entrante vs `Load.estimatedCost` figé, variances, proposition agent.
- **Dispute Desk** `/billing/disputes` — **P1**. Litiges codifiés, suivi de recouvrement.

### WMS
- **Warehouse Flow Board** `/wms/flow` — **P1**. Vue board réception→putaway→pick→staging.

### Yard
- **Dock Scheduler** `/yard/scheduler` — **P1**. Calendrier de portes (RDV × portes × temps).
- **Dwell / Detention Desk** `/yard/dwell` — **P1**. Séjours longs, détention facturable.

### Fleet
- **Fleet Control Room** `/fleet/control-room` — **P1**. Assets prêts vs maintenance vs conformité.
- **Compliance Desk** `/fleet/compliance` — **P1**. Documents expirants par sujet.
- **Asset Availability** `/fleet/availability` — **P1**. Disponibilité dans le temps.

### Connect
- **Connect Studio** `/connect/studio` — **P0 (direction)/P1 (build)**. Canvas des flux entrants/
  sortants ; **Mapping Workbench** `/connect/mapping` — **P1**.

### AI Workforce
- **Agent Operations Center** `/agents/operations` — **P1**. Santé runs 24/7, breaker, file.
- **Policy / Autonomy** `/agents/policy` — **P1**. Dial d'autonomie, caps, policies.

### Manufacturing
- **Planning Runs** `/manufacturing/runs` — **P1**. Historique des `SchedulingRun` + diff.

### Composant transverse
- **`AgentPanel.svelte`** — **P0**. Panneau agent contextuel réutilisable (chat SSE + actions
  approuvables inline), branché dans Dispatch et Finance d'abord. Réutilise le pattern
  `/crm/coach` + `POST /agents` + `agent-conversations`.

---

## 6. Priorités

### P0 — vendabilité rapide (cette session)
1. **Nav claire + langage produit + dé-doublonnage** (`navigation.ts` au squelette canonique).
2. **Accueils modules renforcés** (au minimum Finance, Transport, Fleet alignés sur ui-page-standard).
3. **Load Control Room** (poste profond phare Transport).
4. **Finance cockpit ROI** (la finance devient une salle de recouvrement, pas une liste).
5. **Agent contextuel** (composant `AgentPanel`) dans Dispatch + Finance.
6. **Direction Connect Studio** (au moins le home Connect repositionné « studio/flux »).

### P1 — profondeur métier
WMS Flow Board · Fleet Control Room · Dock Scheduler / Dwell Desk · Exception Desk cross-module ·
Agent Operations Center complet · Rate Studio visuel · Manufacturing Gantt enrichi (style PlaniAdvance).

### P2 — expansion avancée
Continuous Planning · Workflow Config Designer · réseau de données / benchmark anonymisé ·
optimisation OR-Tools/VROOM · ingestion EDI/email/PDF avancée · agents spécialisés par module.

---

## 7. Définition de réussite par phase

**Critère transverse (le test des 10 secondes).** Dans chaque module majeur, l'utilisateur
répond en < 10 s à : *Où suis-je ? · Qu'est-ce qui demande mon attention ? · Quel outil pour
agir ? · Quel registre contient les objets ? · Quel agent travaille avec moi ? · Quelle
preuve/audit soutient l'action ?*

| Phase | Réussite |
| ----- | -------- |
| **1 — IA** | 100 % des domaines suivent le squelette canonique ; 0 doublon de contenu ; libellés en langage produit ; `pnpm typecheck` vert ; nav rendue sans régression. |
| **3 — P0** | Load Control Room et Finance Cockpit répondent aux 6 questions ; agent contextuel visible et fonctionnel (best-effort) dans Dispatch + Finance ; aucune nouvelle frontière de module violée ; aucune migration ; e2e existants verts. |
| **4 — P1** | Chaque module « plat » identifié au §1.3 a gagné ≥ 1 poste profond ; les exceptions cross-module remontent dans un Exception Desk ; Agent Operations Center montre les runs 24/7. |
| **5 — P2** | Planification continue versionnée ; designer de workflow ; au moins un agent spécialisé par module phare. |

---

## 8. Position finale

Pulsar doit devenir l'OS où l'utilisateur pense :
*Je vais dans **Transport** pour opérer · dans **Finance** pour récupérer de l'argent · dans
**Warehouse** pour préparer le flux · dans **Fleet** pour garder les assets prêts · dans
**Connect** pour brancher les systèmes · dans **Agents** pour superviser les employés IA.*

Ce passage — de « SaaS avec menus » à « système d'exploitation métier » — se joue d'abord sur
l'**architecture d'information** (Phase 1, P0), puis sur la **profondeur des postes de travail**
(P0/P1), le tout porté par des **agents contextualisés** et des invariants déjà solides
(gouvernance, isolation tenant, lecture-temps-réel).
