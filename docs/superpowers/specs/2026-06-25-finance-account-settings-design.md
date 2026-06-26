# Finance — Sous-projet #8 : Account settings (paramètres de comptabilité) — Design

Date : 2026-06-25 · Module `billing`. Inspiration ERPNext : Accounts Settings / Paramètres de comptabilité (exercice fiscal, devise, comptes par défaut…).
Décisions tranchées ici (autonomie totale).

## Constat
« Account settings » est **déjà largement couvert** par le framework de config billing (`module-settings.ts`, règle 36) surfacé sur `/billing/config` : tolérances de rapprochement, comptes par défaut (AR/AP/cash/bank/revenue/expense + taxe), préfixes de numéros, devise par défaut, `ledgerAutoPost`, modes de paiement, modèles de taxe. On **n'invente pas** une nouvelle entité — on **enrichit** la config existante d'un réglage réellement consommé.

## Objectif (enrichissement consumer-backed)
Ajouter le **mois de début d'exercice fiscal** (`fiscalYearStartMonth`, 1–12, défaut 1) et le **consommer** dans la fenêtre de variance Budget (sous-projet #5), pour supporter les exercices non calendaires (ex. exercice avril→mars). Défaut 1 = comportement actuel (janvier–décembre) inchangé.

## Périmètre v1 (décidé)
**Inclus :**
- Réglage billing `fiscalYearStartMonth` (number, défaut 1, min 1, max 12) dans `MODULE_SETTINGS_CATALOG` (surfacé automatiquement sur `/billing/config`).
- Helper pur `fiscalYearBounds(fiscalYear, startMonth)` (`@pulsar/shared`) → `{ from: Date; to: Date }` UTC de l'exercice (du 1er du mois de début de `fiscalYear` jusqu'à la veille un an plus tard, fin de journée).
- **Consommation** : `BudgetsService.variance` utilise `fiscalYearBounds(budget.fiscalYear, settings.fiscalYearStartMonth)` au lieu de la fenêtre janvier–décembre codée en dur.

**Reporté :** entité `FiscalYear` multiple/clôture d'exercice, application de `fiscalYearStartMonth` aux Rapports (P&L/cash-flow restent calendaires v1 ; extension future), verrouillage de période.

## Helper pur (`packages/shared/src/billing/fiscal.ts`)
```ts
/** Bornes UTC de l'exercice `fiscalYear` commençant au mois `startMonth` (1–12).
 * startMonth=1 → [fy-01-01 00:00, fy-12-31 23:59:59.999]. startMonth=4 (avril) →
 * [fy-04-01, (fy+1)-03-31 23:59:59.999]. Pur — aucune dépendance Node. */
export function fiscalYearBounds(fiscalYear: number, startMonth: number): { from: Date; to: Date };
```
Implémentation : `from = Date.UTC(fy, startMonth-1, 1)` ; `to = new Date(Date.UTC(fy + (startMonth===1?0:1), ((startMonth-1)+12)%12 ... )` — plus simple : `to = new Date(Date.UTC(fy, startMonth-1, 1)); to.setUTCFullYear(to.getUTCFullYear()+1); to.setUTCMilliseconds(to.getUTCMilliseconds()-1)` (un an moins 1 ms). Clamp `startMonth` à [1,12].

## Consommation Budget
`BudgetsService` injecte `ModuleSettingsService`. Dans `variance`, résoudre `const s = await this.moduleSettings.resolve(tenantId, 'billing')` ; `const startMonth = Number(s.fiscalYearStartMonth) || 1` ; `const { from, to } = fiscalYearBounds(budget.fiscalYear, startMonth)` ; filtrer `JournalLine` sur `entry.date ∈ [from, to]`. Défaut 1 ⇒ fenêtre identique à aujourd'hui (zéro régression e2e budget existant).

## API / UI
- **Aucune nouvelle API/route** : `fiscalYearStartMonth` est un réglage du catalog, modifiable via le `ModuleSettings` existant sur `/billing/config` (PUT `/modules/billing/settings`). Gating inchangé.

## Tests
- Unit shared : `fiscalYearBounds` (startMonth=1 → jan–déc ; startMonth=4 → avril fy → mars fy+1 ; bornes fin-de-journée).
- e2e : budget fiscalYear=Y ligne sur compte 5000 ; poster une charge en janvier Y ; avec `fiscalYearStartMonth=1` la variance l'inclut ; passer `fiscalYearStartMonth=4` (PUT settings) ⇒ la charge de janvier Y tombe HORS de l'exercice Y (qui va d'avril Y à mars Y+1) ⇒ actual exclut la charge. Démontre la consommation. Isolation tenant.

## Conformité hard rules
1 (tenant) · 5 (réglage via `/modules/billing/settings` gating existant) · 36 (config framework — `fiscalYearStartMonth` dans le catalog ; défaut = comportement actuel). Helper pur `@pulsar/shared`. **Aucune écriture GL, aucune migration** (réglage + lecture). Le défaut 1 garantit zéro changement de comportement pour les tenants existants.

## Préparation futur
`fiscalYearStartMonth` = base d'une future entité `FiscalYear`/clôture ; extensible aux Rapports (P&L/cash-flow par exercice).
