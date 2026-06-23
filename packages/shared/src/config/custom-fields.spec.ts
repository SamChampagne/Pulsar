import { describe, it, expect } from 'vitest';
import { CustomFieldEntity, CustomFieldType, validateCustomFields, type CustomFieldDefinition } from './custom-fields';

const defs: CustomFieldDefinition[] = [
  { key: 'poRef', label: 'PO', type: CustomFieldType.TEXT, required: true, showInList: true, sortOrder: 0 },
  { key: 'temp', label: 'Temp', type: CustomFieldType.NUMBER, required: false, showInList: false, sortOrder: 1 },
  { key: 'svc', label: 'Service', type: CustomFieldType.SELECT, options: [{ value: 'STD', label: 'Std' }], required: false, showInList: false, sortOrder: 2 },
];

describe('CustomFieldEntity', () => {
  it('includes CRM entity types', () => {
    expect(CustomFieldEntity.CRM_COMPANY).toBe('CRM_COMPANY');
    expect(CustomFieldEntity.CRM_CONTACT).toBe('CRM_CONTACT');
    expect(CustomFieldEntity.CRM_DEAL).toBe('CRM_DEAL');
  });
});

describe('validateCustomFields', () => {
  it('accepts valid values', () => {
    const r = validateCustomFields(defs, { poRef: 'PO-1', temp: 4, svc: 'STD' });
    expect(r).toEqual({ ok: true, value: { poRef: 'PO-1', temp: 4, svc: 'STD' } });
  });
  it('rejects unknown keys', () => {
    expect(validateCustomFields(defs, { nope: 1 }).ok).toBe(false);
  });
  it('enforces required on full create', () => {
    expect(validateCustomFields(defs, { temp: 4 }).ok).toBe(false); // poRef manquant
  });
  it('skips required check when partial', () => {
    expect(validateCustomFields(defs, { temp: 4 }, { partial: true }).ok).toBe(true);
  });
  it('type-checks each kind', () => {
    expect(validateCustomFields(defs, { poRef: 5 }).ok).toBe(false);
    expect(validateCustomFields(defs, { poRef: 'x', temp: 'no' }).ok).toBe(false);
    expect(validateCustomFields(defs, { poRef: 'x', svc: 'NOPE' }).ok).toBe(false);
  });
  it('treats empty/null on a non-required field as null', () => {
    const r = validateCustomFields(defs, { poRef: 'x', temp: null });
    expect(r).toEqual({ ok: true, value: { poRef: 'x', temp: null } });
  });
});
