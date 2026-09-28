import {
  CatalogItemKind,
  VehicleType,
  TrailerType,
  CarrierStatus,
  DriverStatus,
  type ReferenceKind,
} from '@pulsar/shared';
export type ReferenceRow = Record<string, unknown> & { id: string };
export type ReferenceField = {
  key: string;
  label: string;
  required?: boolean;
  max?: number;
  type?: 'text' | 'email' | 'tel' | 'number';
  options?: string[];
  immutable?: boolean;
};
const code: ReferenceField = {
  key: 'code',
  label: 'Code',
  required: true,
  max: 50,
  immutable: true,
};
const name: ReferenceField = { key: 'name', label: 'Nom', required: true, max: 200 };
const contact: ReferenceField[] = [
  { key: 'email', label: 'Courriel', type: 'email', max: 254 },
  { key: 'phone', label: 'Téléphone', type: 'tel', max: 40 },
];
export const referenceFields: Record<ReferenceKind, ReferenceField[]> = {
  customer: [code, name, { key: 'contactName', label: 'Personne contact', max: 150 }, ...contact],
  carrier: [
    code,
    name,
    { key: 'contactName', label: 'Personne contact', max: 150 },
    ...contact,
    { key: 'scacCode', label: 'SCAC', max: 4 },
    { key: 'mcNumber', label: 'Numéro MC', max: 30 },
    { key: 'dotNumber', label: 'Numéro DOT', max: 30 },
  ],
  client: [code, name, ...contact],
  supplier: [code, name, ...contact],
  item: [
    code,
    name,
    {
      key: 'kind',
      label: 'Nature',
      options: Object.values(CatalogItemKind),
      required: true,
      immutable: true,
    },
    {
      key: 'unit',
      label: 'Unité',
      options: ['EA', 'H', 'KG', 'L', 'M', 'BOX', 'DAY'],
      required: true,
      immutable: true,
    },
    { key: 'description', label: 'Description', max: 4000 },
  ],
  driver: [
    { key: 'firstName', label: 'Prénom', required: true, max: 100 },
    { key: 'lastName', label: 'Nom', required: true, max: 100 },
    ...contact,
    { key: 'licenseNumber', label: 'Numéro de permis', max: 100 },
  ],
  vehicle: [
    { key: 'unitNumber', label: 'Numéro d’unité', required: true, max: 100, immutable: true },
    { key: 'type', label: 'Type de véhicule', options: Object.values(VehicleType), required: true },
    { key: 'make', label: 'Marque', max: 100 },
    { key: 'model', label: 'Modèle', max: 100 },
    { key: 'plate', label: 'Immatriculation', max: 50 },
  ],
  trailer: [
    { key: 'unitNumber', label: 'Numéro d’unité', required: true, max: 100, immutable: true },
    { key: 'type', label: 'Type de remorque', options: Object.values(TrailerType), required: true },
    { key: 'plate', label: 'Immatriculation', max: 50 },
  ],
};
export function referenceLabel(row: ReferenceRow): string {
  return String(
    row.name ?? row.unitNumber ?? [row.firstName, row.lastName].filter(Boolean).join(' '),
  );
}
export const referenceStatuses = {
  carrier: Object.values(CarrierStatus),
  driver: Object.values(DriverStatus),
};
