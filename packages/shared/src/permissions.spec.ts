import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, PERMISSIONS } from './permissions';

describe('PERMISSION_CATALOG', () => {
  it('has no duplicate keys', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('includes the customer portal users permissions', () => {
    expect(PERMISSIONS.CUSTOMER_PORTAL.USERS_READ).toBe('customer-portal.users.read');
    expect(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE).toBe('customer-portal.users.manage');
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(keys).toContain(PERMISSIONS.CUSTOMER_PORTAL.USERS_READ);
    expect(keys).toContain(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE);
  });
});
