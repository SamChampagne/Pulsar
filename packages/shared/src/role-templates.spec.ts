import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from './modules';
import { PERMISSION_CATALOG } from './permissions';
import { ROLE_TEMPLATES, resolveRoleTemplates } from './role-templates';

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
});

describe('resolveRoleTemplates', () => {
  it('drops templates whose module is not enabled and keeps core ones', () => {
    const res = resolveRoleTemplates([MODULE_KEYS.WMS]);
    const keys = res.map((t) => t.key);
    expect(keys).toContain('viewer');
    expect(keys).toContain('warehouse-operator');
    expect(keys).not.toContain('dispatcher');
  });
  it('viewer resolves to every .read key of core + enabled modules only', () => {
    const viewer = resolveRoleTemplates([MODULE_KEYS.BILLING]).find((t) => t.key === 'viewer')!;
    expect(viewer.permissionKeys.length).toBeGreaterThan(0);
    for (const k of viewer.permissionKeys) {
      expect(k.endsWith('.read')).toBe(true);
      const d = PERMISSION_CATALOG.find((p) => p.key === k)!;
      expect([MODULE_KEYS.CORE, MODULE_KEYS.BILLING]).toContain(d.module);
    }
  });
});
