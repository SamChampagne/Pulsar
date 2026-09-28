import { MODULE_KEYS, type ModuleKey } from './modules';
import { PERMISSIONS, type PermissionKey } from './permissions';
import { REFERENCE_ACCESS } from './reference-data';

export type PartyKind = 'customer' | 'client' | 'supplier' | 'crm-company' | 'partner';
export interface PartyAccess {
  path: string;
  kind: PartyKind;
  module: ModuleKey;
  read: PermissionKey;
  manage: PermissionKey;
}
/** Closed consumer catalogue: never accept a module or authority from the payload. */
export const PARTY_ACCESS: readonly PartyAccess[] = [
  ...(REFERENCE_ACCESS.filter((a) =>
    ['customer', 'client', 'supplier'].includes(a.kind),
  ) as PartyAccess[]),
  {
    path: 'transportation/customers',
    kind: 'customer',
    module: MODULE_KEYS.TRANSPORTATION,
    read: PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ,
    manage: PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE,
  },
  {
    path: 'catalog/partners',
    kind: 'partner',
    module: MODULE_KEYS.CATALOG,
    read: PERMISSIONS.CATALOG.READ,
    manage: PERMISSIONS.CATALOG.MANAGE,
  },
  {
    path: 'crm/companies',
    kind: 'crm-company',
    module: MODULE_KEYS.CRM,
    read: PERMISSIONS.CRM.READ,
    manage: PERMISSIONS.CRM.MANAGE,
  },
];

export const PARTY_PROFILE_FIELDS = [
  { key: 'legalName', label: 'Raison sociale', section: 'Entreprise', max: 200 },
  { key: 'tradeName', label: 'Nom commercial', section: 'Entreprise', max: 200 },
  {
    key: 'registrationNumber',
    label: 'Numéro d’immatriculation de l’entreprise',
    section: 'Entreprise',
    max: 100,
  },
  {
    key: 'registrationAuthority',
    label: 'Registre / juridiction d’immatriculation',
    section: 'Entreprise',
    max: 150,
  },
  { key: 'industry', label: 'Secteur d’activité (détail)', section: 'Entreprise', max: 200 },
  { key: 'website', label: 'Site Web', section: 'Entreprise', max: 500, type: 'url' },
  {
    key: 'externalReference',
    label: 'Référence dans le système externe',
    section: 'Relation commerciale',
    max: 100,
  },
  {
    key: 'accountOwner',
    label: 'Responsable de compte (repère)',
    section: 'Relation commerciale',
    max: 150,
  },
  {
    key: 'preferredLanguage',
    label: 'Langue de communication souhaitée',
    section: 'Relation commerciale',
    max: 80,
  },
  {
    key: 'timeZone',
    label: 'Fuseau de l’entreprise',
    section: 'Relation commerciale',
    max: 100,
    type: 'timezone',
  },
  {
    key: 'openingHours',
    label: 'Heures d’ouverture / disponibilité',
    section: 'Consignes internes',
    max: 1000,
    type: 'textarea',
  },
  {
    key: 'orderInstructions',
    label: 'Consignes pour les commandes',
    section: 'Consignes internes',
    max: 2000,
    type: 'textarea',
  },
  {
    key: 'billingInstructions',
    label: 'Consignes pour la facturation',
    section: 'Consignes internes',
    max: 2000,
    type: 'textarea',
  },
  {
    key: 'deliveryInstructions',
    label: 'Consignes pour les livraisons / accès',
    section: 'Consignes internes',
    max: 2000,
    type: 'textarea',
  },
  {
    key: 'internalNotes',
    label: 'Notes internes de la relation',
    section: 'Consignes internes',
    max: 4000,
    type: 'textarea',
  },
] as const;
export type PartyProfileKey = (typeof PARTY_PROFILE_FIELDS)[number]['key'];
export type PartyProfile = Partial<Record<PartyProfileKey, string>> & {
  additional?: Array<{ label: string; value: string }>;
};
export function validatePartyProfile(input: unknown): { value?: PartyProfile; errors: string[] } {
  const errors: string[] = [],
    value: PartyProfile = {};
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { errors: ['La fiche doit être un objet.'] };
  const data = input as Record<string, unknown>;
  const keys = new Set<string>([...PARTY_PROFILE_FIELDS.map((f) => f.key), 'additional']);
  for (const key of Object.keys(data)) if (!keys.has(key)) errors.push(`Champ inconnu : ${key}.`);
  for (const field of PARTY_PROFILE_FIELDS) {
    const raw = data[field.key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.length > field.max) {
      errors.push(`${field.label} : texte de ${field.max} caractères maximum.`);
      continue;
    }
    const text = raw.trim();
    if (text && field.key === 'website') {
      try {
        const url = new URL(text);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw Error();
      } catch {
        errors.push('Site Web : URL HTTP(S) sans identifiants requise.');
      }
    }
    if (text && field.key === 'timeZone') {
      try {
        new Intl.DateTimeFormat('fr', { timeZone: text }).format();
      } catch {
        errors.push('Fuseau IANA invalide (exemple : America/Toronto).');
      }
    }
    if (text) value[field.key] = text;
  }
  if (data.additional !== undefined) {
    if (!Array.isArray(data.additional) || data.additional.length > 20)
      errors.push('20 informations complémentaires maximum.');
    else {
      const seen = new Set<string>();
      value.additional = [];
      for (const row of data.additional) {
        if (
          !row ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          Object.keys(row).some((k) => !['label', 'value'].includes(k)) ||
          typeof row.label !== 'string' ||
          !row.label.trim() ||
          row.label.length > 100 ||
          typeof row.value !== 'string' ||
          row.value.length > 2000
        ) {
          errors.push(
            'Chaque information demande un libellé (100 caractères) et une valeur texte (2000 caractères).',
          );
          continue;
        }
        const key = row.label.trim().toLocaleLowerCase('fr');
        if (seen.has(key)) errors.push(`Libellé en double : ${row.label}.`);
        seen.add(key);
        value.additional.push({ label: row.label.trim(), value: row.value.trim() });
      }
    }
  }
  return errors.length ? { errors } : { errors, value };
}
