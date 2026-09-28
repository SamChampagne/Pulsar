import { isCalendarDate } from '../calendar-date';
import { CURRENCIES } from '../reference/currencies';
import { ledgerAmount, ledgerCents } from './ledger-exact';

export enum FixedAssetOperationKind {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  ACTIVATE = 'ACTIVATE',
  DEPRECIATE = 'DEPRECIATE',
  RETIRE = 'RETIRE',
}
export const ASSET_PLAN_ALGORITHM = 'SL_CUMULATIVE_CENTS_V1' as const;
export interface AssetPlanInput {
  currency: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  acquisitionDate: string;
  depreciationStartMonth: string;
  depreciationExpenseAccountCode: string;
  accumulatedDepreciationAccountCode: string;
}
export interface ExactDepreciationRow {
  ordinal: number;
  period: string;
  date: string;
  amount: string;
  accumulated: string;
  bookValue: string;
}
export interface AssetPlan {
  algorithm: typeof ASSET_PLAN_ALGORITHM;
  input: AssetPlanInput;
  rows: ExactDepreciationRow[];
}
export function buildExactAssetPlan(input: AssetPlanInput): AssetPlan {
  if (!CURRENCIES.some((c) => c.code === input.currency))
    throw Error('Choisissez une devise explicite.');
  if (
    !isCalendarDate(input.acquisitionDate) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.depreciationStartMonth) ||
    !isCalendarDate(input.depreciationStartMonth + '-01')
  )
    throw Error('Date ou premier mois invalide.');
  if (input.depreciationStartMonth < input.acquisitionDate.slice(0, 7))
    throw Error('Le premier mois ne peut pas précéder le mois d’acquisition.');
  if (
    !Number.isInteger(input.usefulLifeMonths) ||
    input.usefulLifeMonths < 1 ||
    input.usefulLifeMonths > 1200
  )
    throw Error('Durée requise : de 1 à 1200 mois.');
  for (const v of [input.cost, input.salvageValue])
    if (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(v))
      throw Error('Montant positif ou nul, exact à deux décimales maximum.');
  const cost = ledgerCents(input.cost),
    salvage = ledgerCents(input.salvageValue),
    base = cost - salvage;
  if (base < 0n) throw Error('La valeur résiduelle ne peut pas dépasser le coût.');
  for (const c of [input.depreciationExpenseAccountCode, input.accumulatedDepreciationAccountCode])
    if (!/^[0-9A-Z]{1,10}$/.test(c)) throw Error('Code de compte invalide.');
  if (input.depreciationExpenseAccountCode === input.accumulatedDepreciationAccountCode)
    throw Error('Les comptes de charge et de cumul doivent être distincts.');
  const [year, month] = input.depreciationStartMonth.split('-').map(Number);
  if (Number(input.acquisitionDate.slice(0, 4)) < 1900 || year < 1900 || year > 2199)
    throw Error('Dates prises en charge : 1900–2199.');
  let prior = 0n;
  const life = BigInt(input.usefulLifeMonths),
    rows: ExactDepreciationRow[] = [];
  for (let i = 1; i <= input.usefulLifeMonths; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, 0)).toISOString().slice(0, 10);
    if (Number(date.slice(0, 4)) > 2199) throw Error('Le plan dépasse l’année 2199.');
    const accumulated = (2n * base * BigInt(i) + life) / (2n * life);
    rows.push({
      ordinal: i,
      period: date.slice(0, 7),
      date,
      amount: ledgerAmount(accumulated - prior),
      accumulated: ledgerAmount(accumulated),
      bookValue: ledgerAmount(cost - accumulated),
    });
    prior = accumulated;
  }
  return {
    algorithm: ASSET_PLAN_ALGORITHM,
    input: { ...input, cost: ledgerAmount(cost), salvageValue: ledgerAmount(salvage) },
    rows,
  };
}
