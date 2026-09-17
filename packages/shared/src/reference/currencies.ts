/**
 * Supported billing currencies (pure, browser-safe). Codes are ISO-4217.
 *
 * The set is intentionally small: these are the currencies the billing module
 * actually prices in today. `defaultCurrency` (billing module settings, rule 36)
 * picks one of them; a picker shows them instead of a free-text field (rule 53).
 */
import type { ReferenceEntry } from './geo';

export interface CurrencyEntry extends ReferenceEntry {
  /** Display symbol — presentation only; never used for arithmetic. */
  symbol: string;
}

export const CURRENCIES: readonly CurrencyEntry[] = [
  { code: 'CAD', name: 'Dollar canadien', symbol: '$' },
  { code: 'USD', name: 'Dollar américain', symbol: 'US$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'MXN', name: 'Peso mexicain', symbol: 'MX$' },
  { code: 'GBP', name: 'Livre sterling', symbol: '£' },
];
