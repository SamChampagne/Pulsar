# Phase 14 — Autonomie & policy engine — Design

> Statut : approuvé (brainstorm 2026-06-15). Acte I de la roadmap Pulsar Agent OS
> ([roadmap](./2026-06-14-pulsar-agent-os-roadmap.md)). Suit la phase 13 (Main-d'œuvre 24/7).
> Dernière brique de substrat avant l'Acte II (agents phares) / l'expansion modulaire.

## Objectif

Délivrer la « très grande autonomie » **sans** lever la gouvernance : remplacer le cadran
d'autonomie grossier (phase 11) par un **moteur de policy déclaratif** (conditions auto-act vs
propose, par outil / tier / montant), unifier les deux points d'application incohérents en **une
seule décision pure**, fermer le trou du cap débit sur le chemin d'auto-approbation, ajouter un
**circuit breaker** (rétrograde un agent qui déraille) et un **score de confiance** qui suggère
(jamais n'impose) une promotion d'autonomie.

## État actuel (phase 11) — ce qu'on remplace/étend

- `AgentAutonomy` (PROPOSE / ACT_LOW / AUTONOMOUS) → `autoApprovedTiers(level)` → `applyAutonomy`
  précalcule `caps.autoApprove` : une **liste plate de noms d'outils** auto-approuvés.
- Caps : `maxAmountPerAction` (montant), `maxActionsPerMinute` (débit), `toolAllowlist`,
  `autoApprove[]` — tous **globaux** à l'agent.
- **Deux points d'application incohérents** :
  - `ProposedActionsService.enqueue` : vérifie montant **+ débit** (compte les proposals de la
    minute glissante).
  - `mcp-server.factory.ts` chemin auto-approbation : vérifie **montant uniquement**. Le cap
    débit y est un **trou documenté** (`TODO`) faute de source de comptage d'exécutions.
- **Trou d'observabilité** : une action auto-approuvée n'est PAS persistée comme `ProposedAction`
  — elle s'exécute et disparaît (auditée seulement via les services métier sous-jacents).

## Décisions verrouillées (brainstorm)

1. **Modèle de policy = règles structurées comme data** (pas un DSL d'expressions, pas un simple
   override du cadran). Évaluées par un moteur **pur** dans `@pulsar/shared`. Un seul point de
   décision.
2. **Échelle d'autonomie = score de confiance + promotion SUGGÉRÉE** (humain confirme ;
   jamais d'escalade automatique).
3. **Circuit breaker = rétrograde en PROPOSE** (réversible ; ne met PAS en pause ; ne touche pas
   `autonomyLevel`).
4. **Auto-approbation désormais persistée** comme `ProposedAction EXECUTED autoApproved=true`
   (corrige le trou de gouvernance + sert de compteur pour le cap débit).
5. **`breakerTrippedAt` en colonne** sur `Agent` (état opérationnel, pas config).
6. **Anomaly detection riche reportée à la phase 15** (Control Tower). La phase 14 n'embarque que
   des signaux de seuil simples alimentant le breaker.

## Architecture

### A. Moteur de policy unifié (`@pulsar/shared/agents/policy.ts`, pur)

```ts
export type PolicyEffect = 'AUTO' | 'PROPOSE' | 'DENY';

export interface PolicyRule {
  tool?: string;       // match un outil précis ; absent = tout outil
  tierMax?: RiskTier;  // s'applique si tier(outil) <= tierMax
  maxAmount?: number;  // si l'action a un montant > maxAmount → AUTO rétrograde en PROPOSE
  effect: PolicyEffect;
}

export interface PolicyContext {
  tool: string;
  tier: RiskTier;
  amount?: number;
  recentExecutions: number;     // actions exécutées (auto + approuvées) sur la minute glissante
  maxPerMinute?: number;        // caps.maxActionsPerMinute
  maxAmountPerAction?: number;  // plafond dur global
  breakerTripped?: boolean;     // si true, force PROPOSE (voir D)
}

export interface PolicyDecision { effect: PolicyEffect; reason?: string; }

export function evaluatePolicy(rules: PolicyRule[], ctx: PolicyContext): PolicyDecision;
```

Sémantique (ordre, déterministe) :
1. READ/LOW → toujours `AUTO` (live) — géré en amont par `isExecutableLive` (inchangé).
2. Sinon, sélectionner la **règle la plus spécifique** qui matche (spécificité décroissante :
   `tool` défini > `tierMax` défini > catch-all ; à spécificité égale, premier dans la liste).
   Si aucune règle ne matche → défaut `PROPOSE`.
3. Appliquer l'effet de la règle :
   - `DENY` → décision `DENY`.
   - `PROPOSE` → décision `PROPOSE`.
   - `AUTO` → vérifier les garde-fous, dans l'ordre, chaque échec **rétrograde en PROPOSE** (pas
     DENY, sauf dépassement du plafond dur) :
     - `breakerTripped` → `PROPOSE` (raison « circuit breaker »).
     - `amount > maxAmountPerAction` (plafond dur global) → `DENY` (jamais auto NI proposé
       au-dessus du plafond dur — cohérent règle 23 : l'autonomie ne lève pas les caps).
     - `amount > rule.maxAmount` (plafond de la règle) → `PROPOSE`.
     - `recentExecutions >= maxPerMinute` → `PROPOSE` (cap débit — **ferme le trou**).
     - sinon → `AUTO`.

Pur, sans I/O, browser-safe (aucun import `node:*`). Réutilise `RiskTier` et la logique des caps
existants (`evaluateAmountCap`/`evaluateRateCap` peuvent être réutilisés en interne).

### B. Résolution des règles effectives d'un agent (`@pulsar/shared`)

```ts
export function presetPolicies(level: AgentAutonomy, legacyAutoApprove?: string[]): PolicyRule[];
export function effectivePolicies(caps: AgentCaps, level: AgentAutonomy): PolicyRule[];
```

- `caps.policies?: PolicyRule[]` (nouveau champ dans le JSON `caps`) est la source de vérité si
  présent.
- Sinon, `presetPolicies(level, caps.autoApprove)` dérive les règles du cadran :
  - `PROPOSE` → `[{ effect: 'PROPOSE' }]` (catch-all).
  - `ACT_LOW` → `[{ tierMax: MUTATING, effect: 'AUTO' }, { tierMax: SENSITIVE, effect: 'PROPOSE' }]`.
  - `AUTONOMOUS` → `[{ tierMax: SENSITIVE, effect: 'AUTO' }]`.
  - + chaque nom dans `caps.autoApprove` (legacy) → `{ tool, effect: 'AUTO' }` (préserve les
    grants explicites des agents existants).
- **Rétro-compatibilité totale** : aucun agent existant ne change de comportement ; aucune
  migration de données.

### C. Auto-approbation tracée + point d'application unique

Le handler d'outil MCP (`mcp-server.factory.ts`) appelle `evaluatePolicy` **une fois** par appel
mutant/sensible :
- Calculer `recentExecutions` = `ProposedAction.count({ agentId, proposedAt >= now-60s })` (inclut
  désormais les actions auto, voir ci-dessous) — fourni au contexte.
- `AUTO` → exécute le handler réel **et persiste** un `ProposedAction { status: EXECUTED,
  autoApproved: true, decidedById: null, resultJson, triggeredByRef }` (via une nouvelle méthode
  `ProposedActionsService.recordAutoExecuted(...)`, idempotente sur `(agentId, idempotencyKey)`).
- `PROPOSE` → `ProposedActionsService.enqueue(...)` (PENDING) — inchangé.
- `DENY` → réponse outil `isError: true` avec la raison.

`ProposedActionsService.enqueue` conserve une **re-vérification défensive** des caps (même helpers
shared) — defense-in-depth ; la décision primaire reste le gate. `approve` (exécution d'un
proposal humainement approuvé) et l'exécution auto **enregistrent leur issue** (succès/échec) via
un point commun qui alimente le circuit breaker (voir D).

### D. Circuit breaker (`@pulsar/shared` + état sur `Agent`)

```ts
export interface BreakerConfig { consecutiveFailures: number; cooldownMs: number; }
export interface BreakerOutcome { failed: boolean; at: number; } // ordre chronologique
export function evaluateCircuitBreaker(recent: BreakerOutcome[], cfg: BreakerConfig): boolean;
```

- Constantes par défaut dans shared : `DEFAULT_BREAKER = { consecutiveFailures: 3, cooldownMs: 15*60_000 }`.
- État persistant : `Agent.breakerTrippedAt DateTime?` (23ᵉ migration).
- **Trip** : après l'échec d'une action (exécution auto OU `approve`), un point commun
  (`ProposedActionsService.recordOutcome`) lit les N derniers outcomes de l'agent ; si
  `evaluateCircuitBreaker` → true et `breakerTrippedAt` est nul → set `breakerTrippedAt = now`,
  `AuditLogsService.log` + `Notification` tenant-wide.
- **Effet** : au gate, `breakerTripped` est vrai si `breakerTrippedAt` est set ET le cooldown
  n'est pas écoulé → force `PROPOSE`. `autonomyLevel` n'est jamais modifié.
- **Réarmement** : (1) **auto** — si `breakerTrippedAt` set mais `now - breakerTrippedAt >
  cooldownMs`, le gate le considère réarmé (et le efface paresseusement) ; (2) **humain** —
  `POST /agents/:id/reset-breaker` efface `breakerTrippedAt` immédiatement (permission
  `agents.manage`, audité).
- L'agent **continue de travailler** ses tâches (phase 13) ; seul l'auto-approbation est suspendu.

### E. Score de confiance + promotion suggérée (`@pulsar/shared` + API)

```ts
export interface TrustStats {
  executed: number; rejected: number; failed: number;
  runsSucceeded: number; runsTotal: number; breakerTrips: number;
}
export interface TrustResult { score: number; readyForNext: boolean; reasons: string[]; }
export function computeTrustScore(stats: TrustStats, level: AgentAutonomy): TrustResult;
```

- Pur ; score 0–100 (ex. pondération : taux d'approbation, ratio succès des runs, pénalité
  échecs/trips). `readyForNext` true si score ≥ seuil ET volume minimal d'actions atteint ET
  `level !== AUTONOMOUS`. Seuils = constantes shared (`TRUST_PROMOTION = { minScore: 80,
  minActions: 25 }`).
- `GET /agents/:id/trust` (permission `agents.read`) : agrège `ProposedAction` (executed/rejected/
  failed) + `AgentRun` (succeeded/total) + un compteur de trips, calcule à la lecture (pas de
  colonne dédiée), renvoie `TrustResult` + le `nextLevel` suggéré.
- UI : bandeau sur `/agents/[id]` « Cet agent est prêt pour {nextLevel} » + bouton qui appelle le
  `PATCH /agents/:id` existant (`autonomyLevel`). **Confirmation humaine obligatoire.**

### F. Données — 23ᵉ migration

- `ProposedAction.autoApproved Boolean @default(false)` — distingue auto vs approuvé-humain
  (filtrage, métriques, lisibilité du ledger). `decidedById` reste null pour les auto.
- `Agent.breakerTrippedAt DateTime?`.
- `caps.policies` vit dans le JSON `caps` existant (aucune migration).
- `PolicyRule`/`PolicyEffect`/`BreakerConfig`/`TrustStats` + seuils → `@pulsar/shared` (pure data,
  browser-safe). Pas de miroir Prisma (data JSON, pas une colonne enum).

### G. API

- `mcp-server.factory.ts` : décision unique via `evaluatePolicy` (voir C).
- `GET /agents/:id/trust` → `TrustResult` + `nextLevel`.
- `POST /agents/:id/reset-breaker` (permission `agents.manage`) → efface `breakerTrippedAt`, audité.
- `GET /agents/:id` enrichi : `breakerTrippedAt` exposé (via `agentSelect` — pas un secret) pour
  l'UI ; jamais `secretHash`/`serviceUserId` (règle 26).
- Le `PATCH /agents/:id` existant accepte `caps.policies` (validation : effets ∈ {AUTO,PROPOSE,
  DENY}, outils connus du registre, montants ≥ 0).

### H. UI (étend `/agents/[id]`)

- **Section Autonomie & policies** : éditeur de règles simple (liste de `{outil?, tierMax?,
  maxAmount?, effet}`) au-dessus du cadran ; le cadran reste pour les presets.
- **Bandeau de confiance** : score + suggestion de promotion (bouton confirmé).
- **Bandeau breaker** : si `breakerTrippedAt` set → « Circuit breaker actif (rétrogradé en
  PROPOSE) » + bouton « Réarmer ».

### I. Nouvelle règle dure (CLAUDE.md, phase 14)

> **29. (phase 14 — Autonomie & policies)** Toute décision auto-act vs propose passe par
> `evaluatePolicy` (`@pulsar/shared`, pur) au **point d'application unique** du handler MCP ;
> les règles effectives viennent de `caps.policies` ou du preset dérivé de `autonomyLevel`
> (+ `caps.autoApprove` legacy). Une action auto-approuvée est TOUJOURS persistée comme
> `ProposedAction EXECUTED autoApproved=true` (auditable + comptée pour le cap débit — le chemin
> auto respecte désormais le débit). Le circuit breaker (`Agent.breakerTrippedAt`) rétrograde en
> PROPOSE de façon réversible et ne modifie JAMAIS `autonomyLevel` ; la promotion d'autonomie est
> TOUJOURS confirmée par un humain (jamais d'escalade automatique). Le plafond dur
> `maxAmountPerAction` n'est jamais levé par l'autonomie (au-dessus → DENY), règles 23/24
> préservées.

## Tests

Unit (`@pulsar/shared`, vitest) :
- `evaluatePolicy` : sélection par spécificité ; AUTO/PROPOSE/DENY ; downgrade montant (règle) ;
  DENY au-dessus du plafond dur ; downgrade débit ; `breakerTripped` force PROPOSE.
- `presetPolicies`/`effectivePolicies` : rétro-compat avec chaque `AgentAutonomy` + `autoApprove`.
- `computeTrustScore` : monotonie, `readyForNext` aux seuils, plafonné à AUTONOMOUS.
- `evaluateCircuitBreaker` : trip à N échecs consécutifs ; pas de trip si succès intercalé.

Unit (API) : `ProposedActionsService.recordAutoExecuted` (idempotent, autoApproved) ;
`recordOutcome` → trip du breaker ; le gate force PROPOSE quand breaker actif.

E2e (DB seedée, faux runtime) :
1. Agent avec `policies` AUTO `create_load` ≤ $X → exécute live + `ProposedAction EXECUTED
   autoApproved=true` créé.
2. Même outil au-dessus de $X → `PROPOSE` (PENDING).
3. Au-dessus du plafond dur global → `DENY` (erreur outil, rien persisté en EXECUTED).
4. Cap débit dépassé sur le chemin auto → `PROPOSE` (**le trou fermé**).
5. N échecs consécutifs → `breakerTrippedAt` set → action suivante `PROPOSE` même si la règle dit
   AUTO ; `POST /reset-breaker` réarme → AUTO de nouveau.
6. `GET /agents/:id/trust` → score + `readyForNext`/`nextLevel` cohérents avec l'historique.

## Hors périmètre (phases suivantes)

- Anomaly detection riche (statistique/ML) → phase 15 (Control Tower).
- Promotion d'autonomie automatique → exclue (décision : toujours humain).
- DSL d'expressions sur les args → exclu (décision : règles structurées suffisent).
- KPI par agent / dashboard manager / red-team → phase 15.
