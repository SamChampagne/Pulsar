# Roadmap stratégique — Pulsar Agent OS (phases 12 → 22)

> 🇫🇷 Plan multi-phases adopté le 2026-06-14. Décompose la vision « OS logistique
> modulaire avec agents-employés 24/7 » en 11 phases regroupées en 3 actes.
> Chaque phase fera l'objet de son propre cycle brainstorm → spec → plan au moment de la lancer.
> Contexte : [etat-du-projet.md](../../etat-du-projet.md) · audit : [audit-tms-2026-06-10.md](../../audit-tms-2026-06-10.md) · règles : [CLAUDE.md](../../../CLAUDE.md).

## North star

> **Pulsar = operating system logistique modulaire où des agents Hermes tournent 24/7
> comme employés numériques gouvernés.**
> Chaque module métier expose des opérations outillées ; chaque agent a une fiche de poste,
> des outils, des plafonds, des KPI et un kill switch — et travaille sans qu'un humain tape
> dans un chat. La différenciation n'est pas « TMS + chatbot » : c'est le combo *modules
> solides + modèle event/task + agents-employés + gouvernance stricte*. Fleetbase n'a aucune IA ;
> c'est notre axe.

## Décisions verrouillées (2026-06-14)

1. **Arc = agents d'abord, puis modules tressés.** On rend les agents pleinement employés
   24/7 sur les 3 modules actuels (Acte I), on livre les agents phares à ROI (Acte II), PUIS
   on étend la plateforme module par module — **chaque nouveau module arrive avec son agent
   dédié** (Acte III). Jamais de module « nu ».
2. **Agent phare = agent répartition/exceptions.** Réutilise le moteur de retards (phase 8) +
   les outils MCP + la file de gouvernance (phase 11). Zéro plomberie de données lourde. C'est
   la démonstration la plus pure d'un employé numérique. Le Freight Audit suit en Acte II.
3. **Autonomie = agent système toujours allumé.** Pas de « quarts ». Réveillé par
   événement/cron, traite sa file de cas, agit sous caps/policies, n'escalade à l'humain que
   sur exception. La roadmap construit progressivement cette « échelle d'autonomie » (très
   élevée mais jamais hors gouvernance).

## Ce qui existe déjà (à étendre, pas reconstruire)

Le palier 11 a déjà livré ~70 % du substrat « agent gouverné » que la cible décrit :
identité `Agent` (service-user caché par agent), permissions ∩ modules ∩ allowlist, caps
montant/débit, idempotence, niveaux d'autonomie (`PROPOSE`/`ACT_LOW`/`AUTONOMOUS`), file
`ProposedAction`, inbox d'approbation auditée, kill switch (service-user DISABLED), runtime
Hermes managé par tenant, espace `/agents`. **Les phases ci-dessous étendent ce socle** ;
elles ne repartent pas de zéro. De même, le `DelayDetectionService` (phase 8, événements
`DELAYED` + Notifications) et l'outbox webhook sont les germes du bus d'événements.

## Précondition

**Merger la branche `phase-11`** dans `main` (67 commits, PR à créer) avant d'ouvrir la
phase 12. Housekeeping, hors roadmap.

---

## ACTE I — Le substrat opérationnel (faire des agents de vrais employés 24/7)

### Phase 12 — Operating Workbench (tranche verticale)

Le squelette commun de travail, **prouvé par un agent réel de bout en bout** :

- `DomainEvent` (formalisation du flux d'événements, en s'appuyant sur l'outbox existant) ;
- `EventPolicy` simples (événement → tâche/cas) ;
- `OperationalTask` + `ExceptionCase` (entités + machine d'états dans `@pulsar/shared`) ;
- **inbox unifiée** humains + agents ;
- *upgrade* du moteur de retards phase 8 pour émettre des `ExceptionCase` (au lieu de seules
  Notifications) ;
- **l'agent répartition/exceptions** réveillé par événement, traitant sa file, proposant
  re-tender / re-route / notifier **via la file `ProposedAction` existante** ;
- boucle « always-on » *minimale* : juste assez pour que l'agent travaille **sans ⌘K**.

Bénéfice de séquençage : le moteur d'événements débloque une partie du verrou §19.5
(planification continue, phase 17).

### Phase 13 — La main-d'œuvre 24/7

Généraliser la boucle de la phase 12 en runtime d'agents permanents :

- n'importe quel agent devient *always-on* (déclenché par événement ou cron) ;
- passage du modèle « un process Hermes par conversation » à « un worker agent permanent » ;
- heartbeat, historique de runs, concurrence, retries, kill switch appliqué à chaud ;
- isolation tenant préservée (l'enregistrement MCP de Hermes est process-global — cf. règle 24).

C'est ce qui fait des agents des employés, pas des assistants de chat.

### Phase 14 — Moteur d'autonomie & policies

Délivrer la « très grande autonomie » **sans** lever la gouvernance :

- **policy-as-data** : conditions sous lesquelles un agent auto-agit vs propose (par outil,
  montant, règle métier) — extension de `caps.autoApprove` vers un vrai moteur de règles ;
- échelle d'autonomie graduée (l'agent gagne de la confiance dans le temps) ;
- garde-fous : rate limits, circuit breakers, détection d'anomalie ;
- les plafonds (`evaluateAmountCap`/`evaluateRateCap` de `@pulsar/shared`) grandissent ici.

### Phase 15 — Control Tower des agents (observabilité + confiance)

On ne gouverne 24/7 que ce qu'on mesure :

- KPI par agent (actions, taux d'approbation, économies, erreurs, latence) ;
- tableau de bord « manager » + timeline d'activité/audit ;
- **banc de test red-team** : prompt injection + isolation cross-tenant ;
- playbooks (procédures attachées à un rôle d'agent).

---

## ACTE II — Les agents phares (profondeur + ROI sur les modules actuels)

### Phase 16 — Freight Audit autonome (§19.4)

Le ROI le plus vendable (2-5 % des montants) :

- entité « facture transporteur entrante » (découplée des `Load` COMPLETED internes) ;
- entité « expédition importée » ;
- matching contre `Load.estimatedCost` / `costDetail` (jamais de recompute — règle 16) ;
- tolérance + workflow de litige (réutilise le rapprochement buy-side existant) ;
- agent audit autonome qui ingère, matche, ouvre les litiges via le Workbench ;
- KPI économies récupérées.

### Phase 17 — Planification continue (§19.5 — le verrou architectural)

Le pari le plus coûteux, **délibérément placé tard** une fois le substrat solide :

- plans / routes **versionnés** (aujourd'hui recréés from scratch, non versionnés) ;
- ordres mutables après confirmation **avec diff** (aujourd'hui immuables après DRAFT) ;
- `PlanProposal` / `PlanCommit` (engine registry : manual, greedy, rate-shopping ;
  VROOM/OR-Tools plus tard) ;
- l'agent dispatcher propose des plans complets via le même contrat de gouvernance.

---

## ACTE III — Expansion modulaire (tressé : chaque module livré AVEC son agent)

> **Ordre ré-ordonnable** : on choisira chaque module par affinité-agent au moment venu.
> Ordre par défaut ci-dessous. Recette d'ajout de module = section dédiée de [CLAUDE.md](../../../CLAUDE.md).

- **Phase 18 — Integrations / Connectivité** + agents d'intégration & mapping d'exceptions.
  Modèle canonique de message entrant (courriel / PDF / EDI 204/214/210). **En tête de
  l'acte III** car ça nourrit tous les autres agents et renforce rétroactivement le freight
  audit (ingestion PDF).
- **Phase 19 — Yard / Dock scheduling** + Dock Scheduler Agent (rendez-vous, portes, check-in/out,
  dwell/detention). Très propice aux agents. **Porte l'enabler transversal** : configurabilité
  minimale (custom fields, checklists, requirement policies).
- **Phase 20 — Fleet** + agent maintenance / conformité (actifs internes, télématique, coûts).
- **Phase 21 — Light WMS** + agent préparation entrepôt (inventory simple, pick/pack/ship, staging).
- **Phase 22 — Analytics / Control Tower métier + effet réseau de données** (§19.6) + agents
  analyste ops / économies (OTIF, scorecards, KPI par lane, benchmarks inter-tenants anonymisés
  avec consentement par tenant).

## Enabler transversal (pas une phase autonome)

Configurabilité opérationnelle minimale (custom fields typés, checklists, requirement/notification
policies) — atterrit avec le premier module qui en a besoin (Yard, phase 19). UI simple,
**pas** de no-code complexe.

## Grille de cadrage par phase

Au lancement de chaque phase, son brainstorm répondra à : problème métier · persona · objets
métier · workflow · domain events · tasks/cases · MCP tools · risques · policies/approvals/caps ·
audit/evidence · KPI · intégrations · slice MVP · go/no-go. Pour chaque agent : identité/rôle/owner ·
modules & tenants autorisés · tools allowlist · caps · risk tiers · approbations · prompt/model/runtime ·
playbooks · evidence · KPI · tests prompt-injection/cross-tenant · kill switch.
