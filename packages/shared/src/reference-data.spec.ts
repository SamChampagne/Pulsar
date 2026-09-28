import { describe, it, expect } from 'vitest';
import { REFERENCE_ACCESS, referenceAccess } from './reference-data';
import { MODULE_CATALOG } from './modules';
import { PERMISSION_CATALOG } from './permissions';
describe('Shared reference capabilities', () => {
  it('uses unique static paths and existing module-specific permissions', () => {
    expect(new Set(REFERENCE_ACCESS.map((a) => a.path)).size).toBe(REFERENCE_ACCESS.length);
    for (const access of REFERENCE_ACCESS) {
      expect(MODULE_CATALOG.some((m) => m.key === access.module && m.available)).toBe(true);
      expect(access.path.startsWith(access.module + '/')).toBe(true);
      for (const permission of [access.read, access.manage]) {
        expect(permission.startsWith(access.module + '.')).toBe(true);
        expect(PERMISSION_CATALOG.some((p) => p.key === permission)).toBe(true);
      }
      expect(referenceAccess('/' + access.path)).toBe(access);
    }
  });
  it('does not infer access from arbitrary paths or replace specialized workflows', () => {
    for (const path of [
      '/fleet/data/loads',
      '/wms/inventory',
      '/services/data/invoices',
      '/billing/data/supplier-invoices',
      '/transportation/customers',
    ])
      expect(referenceAccess(path)).toBeUndefined();
    expect(referenceAccess('/billing/data/suppliers')).toMatchObject({
      module: 'billing',
      kind: 'supplier',
      read: 'billing.supplier-invoices.read',
      manage: 'billing.supplier-invoices.manage',
    });
    expect(REFERENCE_ACCESS.filter((a) => a.module === 'services').map((a) => a.kind)).toEqual([
      'client',
      'item',
    ]);
  });
});
