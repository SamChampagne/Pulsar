import { TRANSPORT_FIELD_GUIDES } from './transport-field-reference';
import { DISTRIBUTION_FIELD_GUIDES } from './distribution-field-reference';
import { AI_FIELD_GUIDES } from './ai-field-reference';
import { WMS_FIELD_GUIDES } from './wms-field-reference';
import { MANUFACTURING_FIELD_GUIDES } from './manufacturing-field-reference';
import type { FieldAccess, FieldGuide, FieldReference } from './field-reference-types';
export type { FieldAccess, FieldGuide, FieldReference } from './field-reference-types';
export const FIELD_GUIDES: FieldGuide[] = [
  ...TRANSPORT_FIELD_GUIDES,
  ...DISTRIBUTION_FIELD_GUIDES,
  ...WMS_FIELD_GUIDES,
  ...MANUFACTURING_FIELD_GUIDES,
  ...AI_FIELD_GUIDES,
];
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim();
function matches(text: string, query: string) {
  const normalized = normalize(text);
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalized.includes(token));
}
export function visibleFieldGuides(access: FieldAccess) {
  return FIELD_GUIDES.filter(
    (guide) =>
      access.domains.includes(guide.domain) &&
      guide.permissions.every(access.can) &&
      (guide.modules ?? []).every((module) => access.modules.includes(module)),
  );
}
export function matchesField(field: FieldReference, query: string) {
  return matches(Object.values(field).join(' '), query);
}
export function matchesFieldGuide(guide: FieldGuide, query: string) {
  return (
    matches([guide.title, guide.summary, ...guide.rules].join(' '), query) ||
    guide.fields.some((field) => matchesField(field, query))
  );
}
export function visibleToolExamples(guide: FieldGuide, access: FieldAccess) {
  return (guide.examples ?? []).filter(
    (example) =>
      example.modules.every((module) => access.modules.includes(module)) &&
      example.permissions.every(access.can),
  );
}
