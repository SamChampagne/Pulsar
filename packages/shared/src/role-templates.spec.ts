import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from './modules';
import { PERMISSION_CATALOG, PERMISSIONS } from './permissions';
import { ROLE_TEMPLATES, VIEWER_EXCLUDED_KEYS, resolveRoleTemplates } from './role-templates';

const catalogKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));

describe('ROLE_TEMPLATES', () => {
  it('has unique kebab-case keys', () => {
    const keys = ROLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });
  it('only references catalog permissions', () => {
    for (const t of ROLE_TEMPLATES)
      for (const k of t.permissionKeys) expect(catalogKeys.has(k), `${t.key}:${k}`).toBe(true);
  });
  it('dispatcher gains customer-portal.users.read (portal accounts oversight)', () => {
    const dispatcher = ROLE_TEMPLATES.find((t) => t.key === 'dispatcher')!;
    expect(dispatcher.permissionKeys).toContain(PERMISSIONS.CUSTOMER_PORTAL.USERS_READ);
  });
});

describe('resolveRoleTemplates', () => {
  it('drops templates whose module is not enabled and keeps core ones', () => {
    const res = resolveRoleTemplates([MODULE_KEYS.WMS]);
    const keys = res.map((t) => t.key);
    expect(keys).toContain('viewer');
    expect(keys).toContain('warehouse-operator');
    expect(keys).not.toContain('dispatcher');
  });
  it('viewer never contains a sensitive platform read (audit, email, api keys, users, roles)', () => {
    const viewer = resolveRoleTemplates([MODULE_KEYS.WMS, MODULE_KEYS.BILLING]).find(
      (t) => t.key === 'viewer',
    )!;
    for (const excluded of VIEWER_EXCLUDED_KEYS) {
      expect(viewer.permissionKeys, excluded).not.toContain(excluded);
    }
    // ...while still granting the ordinary module reads.
    expect(viewer.permissionKeys).toContain('wms.read');
    expect(viewer.permissionKeys).toContain('core.locations.read');
  });
  it('every excluded key is a real catalog key ending in .read', () => {
    for (const k of VIEWER_EXCLUDED_KEYS) {
      expect(catalogKeys.has(k), k).toBe(true);
      expect(k.endsWith('.read'), k).toBe(true);
    }
  });
  it('viewer resolves to every .read key of core + enabled modules only', () => {
    const viewer = resolveRoleTemplates([MODULE_KEYS.BILLING]).find((t) => t.key === 'viewer')!;
    expect(viewer.permissionKeys.length).toBeGreaterThan(0);
    for (const k of viewer.permissionKeys) {
      expect(k.endsWith('.read')).toBe(true);
      const d = PERMISSION_CATALOG.find((p) => p.key === k)!;
      expect([MODULE_KEYS.CORE, MODULE_KEYS.BILLING]).toContain(d.module);
      expect(VIEWER_EXCLUDED_KEYS).not.toContain(k);
    }
  });
});
