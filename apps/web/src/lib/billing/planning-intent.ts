import {
  CURRENCIES,
  validateAccountingTarget,
  validateBudgetLines,
  validateBudgetPeriod,
} from '@pulsar/shared';
export interface PlanningIntent {
  path: string;
  method: 'POST' | 'PATCH' | 'PUT';
  body: Record<string, unknown> & { operationKey: string };
}
export function readPlanningIntent(key: string): PlanningIntent | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (
      !p ||
      !p.body ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        p.body.operationKey,
      )
    )
      throw Error();
    if (
      !(
        (p.path === '/billing/accounting-profile' && p.method === 'PUT') ||
        (p.path === '/billing/budgets' && p.method === 'POST') ||
        (/^\/billing\/budgets\/[a-zA-Z0-9_-]+$/.test(p.path) && p.method === 'PATCH')
      )
    )
      throw Error();
    const b = p.body;
    if (p.method === 'PUT') {
      if (
        typeof b.externalSystem !== 'string' ||
        typeof b.reason !== 'string' ||
        b.reason.trim().length < 3 ||
        b.reason.length > 500 ||
        b.externalSystem.length > 120 ||
        !Number.isInteger(b.expectedVersion) ||
        b.expectedVersion < 0
      )
        throw Error();
      validateAccountingTarget(b.target, b.targetCurrency, b.externalSystem);
    } else {
      if (
        typeof b.name !== 'string' ||
        !b.name.trim() ||
        b.name.length > 80 ||
        typeof b.isActive !== 'boolean'
      )
        throw Error();
      validateBudgetLines(b.lines);
      if (p.method === 'POST') {
        if (
          !Number.isInteger(b.fiscalYear) ||
          b.fiscalYear < 2000 ||
          b.fiscalYear > 2100 ||
          !CURRENCIES.some((c) => c.code === b.currency)
        )
          throw Error();
        validateBudgetPeriod(b.periodFrom, b.periodTo, b.fiscalYear);
      } else if (!Number.isInteger(b.expectedVersion) || b.expectedVersion < 1) throw Error();
    }
    return p;
  } catch {
    throw Error(
      'Demande conservée illisible. Faites vérifier son résultat avant toute nouvelle saisie.',
    );
  }
}
export function rememberPlanningIntent(key: string, p: PlanningIntent) {
  const prior = readPlanningIntent(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(p))
    throw Error('Une demande attend déjà confirmation.');
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    throw Error('Impossible de conserver la demande. Rien n’a été envoyé.');
  }
}
