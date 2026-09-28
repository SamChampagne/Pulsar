import { isCalendarDate } from './calendar-date';
import { isValidPhone, isValidPostalCode } from './reference/input-validation';

// Mirrored in Prisma. A directory entry never grants an application permission.
export enum PartyDirectoryKind {
  ADDRESS = 'ADDRESS',
  CONTACT = 'CONTACT',
}
export interface DirectoryAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  countryCode: string;
  postalCode: string;
}
export interface DirectoryEntryData {
  kind: PartyDirectoryKind;
  label: string;
  role: string;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  email: string;
  phone: string;
  address: DirectoryAddress | null;
  notes: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** Closed, browser-safe input contract; does not infer identity from name or email. */
export function validateDirectoryEntry(input: unknown): {
  value?: DirectoryEntryData;
  errors: string[];
} {
  const errors: string[] = [];
  if (!record(input)) return { errors: ['Fiche invalide.'] };
  const keys = [
    'kind',
    'label',
    'role',
    'active',
    'validFrom',
    'validUntil',
    'email',
    'phone',
    'address',
    'notes',
  ];
  if (Object.keys(input).some((k) => !keys.includes(k)))
    errors.push('Champ non autorisé dans le carnet.');
  const text = (o: Record<string, unknown>, key: string, max: number, required = false): string => {
    const raw = o[key];
    if (raw === undefined || raw === null) {
      if (required) errors.push(`${key} est requis.`);
      return '';
    }
    if (typeof raw !== 'string') {
      errors.push(`${key} doit être un texte.`);
      return '';
    }
    const v = raw.trim();
    if ((required && !v) || v.length > max)
      errors.push(`${key} : longueur invalide (maximum ${max}).`);
    return v;
  };
  const kind = input.kind as PartyDirectoryKind;
  if (!Object.values(PartyDirectoryKind).includes(kind)) errors.push('Type de fiche invalide.');
  if (typeof input.active !== 'boolean') errors.push('Indiquez si la fiche est active.');
  const dates = ['validFrom', 'validUntil'].map((key) => {
    const v = input[key];
    if (v === null || v === undefined || v === '') return null;
    if (!isCalendarDate(v)) {
      errors.push('Date invalide : choisissez un jour réel entre 1900 et 2199.');
      return null;
    }
    return v;
  });
  if (dates[0] && dates[1] && dates[1] <= dates[0])
    errors.push('La fin exclusive doit être après le début.');
  const email = text(input, 'email', 254),
    phone = text(input, 'phone', 40);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Courriel invalide.');
  if (!isValidPhone(phone)) errors.push('Téléphone invalide : chiffres et extension seulement.');
  let address: DirectoryAddress | null = null;
  if (kind === PartyDirectoryKind.ADDRESS) {
    if (!record(input.address)) errors.push('Une adresse complète est requise.');
    else {
      const a = input.address;
      if (
        Object.keys(a).some(
          (k) => !['line1', 'line2', 'city', 'region', 'countryCode', 'postalCode'].includes(k),
        )
      )
        errors.push('Champ d’adresse non autorisé.');
      address = {
        line1: text(a, 'line1', 200, true),
        line2: text(a, 'line2', 200),
        city: text(a, 'city', 100, true),
        region: text(a, 'region', 100),
        countryCode: text(a, 'countryCode', 2, true).toUpperCase(),
        postalCode: text(a, 'postalCode', 12),
      };
      if (!/^[A-Z]{2}$/.test(address.countryCode))
        errors.push('Pays : code ISO de deux lettres requis.');
      if (
        !isValidPostalCode(address.postalCode, address.countryCode) ||
        (['CA', 'US'].includes(address.countryCode) && !address.postalCode)
      )
        errors.push('Code postal invalide pour ce pays.');
    }
  } else if (input.address !== null && input.address !== undefined)
    errors.push('Un contact ne contient pas de fiche adresse.');
  const value: DirectoryEntryData = {
    kind,
    label: text(input, 'label', 160, true),
    role: text(input, 'role', 100, true),
    active: input.active as boolean,
    validFrom: dates[0],
    validUntil: dates[1],
    email,
    phone,
    address,
    notes: text(input, 'notes', 1000),
  };
  return errors.length ? { errors } : { value, errors };
}
/** Civil dates, inclusive start / exclusive end. This is NOT access control. */
export function directoryValidity(
  entry: Pick<DirectoryEntryData, 'active' | 'validFrom' | 'validUntil'>,
  on: string,
): 'ACTIVE' | 'INACTIVE' | 'UPCOMING' | 'EXPIRED' | 'UNKNOWN' {
  if (!isCalendarDate(on)) return 'UNKNOWN';
  if (!entry.active) return 'INACTIVE';
  if (entry.validFrom && on < entry.validFrom) return 'UPCOMING';
  if (entry.validUntil && on >= entry.validUntil) return 'EXPIRED';
  return 'ACTIVE';
}
