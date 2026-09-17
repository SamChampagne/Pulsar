import { describe, it, expect, vi } from 'vitest';
// Catalogue tests exercise gates, not Svelte icon rendering (covered in browser tests).
vi.mock('lucide-svelte', () =>
  Object.fromEntries(
    [
      'LayoutDashboard',
      'Truck',
      'Warehouse',
      'Container',
      'Boxes',
      'CircleDollarSign',
      'Bot',
      'Settings',
      'Cable',
      'BarChart3',
      'ClipboardList',
      'FileText',
      'Palette',
      'Handshake',
      'Mail',
      'Globe',
      'Factory',
    ].map((name) => [name, () => null]),
  ),
);
import { visibleDomains } from './navigation';

describe('Platform: Quoi de neuf link', () => {
  const platformLinks = (modules: string[] = [], permissions: string[] = []) =>
    visibleDomains({ enabledModules: modules, can: (p) => permissions.includes(p) })
      .find((d) => d.key === 'dashboard')
      ?.sections.flatMap((s) => s.links)
      .map((l) => l.href) ?? [];

  it('shows /whats-new right after /dashboard for any user', () => {
    const links = platformLinks();
    expect(links).toContain('/whats-new');
    expect(links.indexOf('/whats-new')).toBe(links.indexOf('/dashboard') + 1);
  });

  it('includes /whats-new in the dashboard domain prefixes', () => {
    const domain = visibleDomains({ enabledModules: [], can: () => false }).find(
      (d) => d.key === 'dashboard',
    );
    expect(domain?.prefixes).toContain('/whats-new');
  });
});

describe('Fleet cross-module navigation', () => {
  const links = (modules: string[], permissions: string[]) =>
    visibleDomains({ enabledModules: modules, can: (p) => permissions.includes(p) })
      .flatMap((d) => d.sections.flatMap((s) => s.links))
      .map((l) => l.href);
  it('keeps the workspace accessible without TMS permissions', () => {
    const result = links(['fleet'], ['fleet.read']);
    expect(result).toContain('/fleet');
    expect(result).not.toContain('/fleet/register');
    expect(result).not.toContain('/fleet/maintenance');
  });
  it('shows the preserved registers to cross-module readers', () => {
    expect(
      links(['fleet', 'transportation'], ['fleet.read', 'transportation.master-data.read']),
    ).toContain('/fleet/register');
  });
  it('hides TMS-dependent registers when that module is disabled', () => {
    expect(links(['fleet'], ['fleet.read', 'transportation.master-data.read'])).not.toContain(
      '/fleet/register',
    );
  });
});

describe('Settings: roles and core locations navigation', () => {
  const settingsLinks = (modules: string[], permissions: string[]) =>
    visibleDomains({ enabledModules: modules, can: (p) => permissions.includes(p) })
      .find((d) => d.key === 'settings')
      ?.sections.flatMap((s) => s.links)
      .map((l) => l.href) ?? [];

  it('shows /settings/roles with core.roles.read', () => {
    expect(settingsLinks([], ['core.roles.read'])).toContain('/settings/roles');
  });

  it('hides /settings/roles without the permission', () => {
    expect(settingsLinks([], [])).not.toContain('/settings/roles');
  });

  it('shows /locations under Réglages with core.locations.read (no /settings/locations route)', () => {
    const links = settingsLinks([], ['core.locations.read']);
    expect(links).toContain('/locations');
    expect(links).not.toContain('/settings/locations');
  });
});

describe('WMS: Entrepôts link requires core.locations.read', () => {
  const wmsLinks = (permissions: string[]) =>
    visibleDomains({ enabledModules: ['wms'], can: (p) => permissions.includes(p) })
      .find((d) => d.key === 'wms')
      ?.sections.flatMap((s) => s.links)
      .map((l) => l.href) ?? [];

  it('shows /wms/warehouses as the first link of Données with core.locations.read', () => {
    const links = wmsLinks(['core.locations.read']);
    expect(links).toContain('/wms/warehouses');
    const donnees = visibleDomains({
      enabledModules: ['wms'],
      can: (p) => p === 'core.locations.read',
    })
      .find((d) => d.key === 'wms')
      ?.sections.find((s) => s.links.some((l) => l.href.startsWith('/wms/items')));
    expect(donnees?.links[0]?.href).toBe('/wms/warehouses');
  });

  it('hides /wms/warehouses without the permission', () => {
    expect(wmsLinks([])).not.toContain('/wms/warehouses');
  });
});

describe('Customer portal navigation domain', () => {
  const domain = (modules: string[], permissions: string[]) =>
    visibleDomains({ enabledModules: modules, can: (p) => permissions.includes(p) }).find(
      (d) => d.key === 'customer-portal',
    );

  it('is hidden when the customer-portal module is disabled', () => {
    expect(domain([], ['customer-portal.links.manage'])).toBeUndefined();
  });

  it('is hidden when the module is enabled but the permission is missing', () => {
    expect(domain(['customer-portal'], [])).toBeUndefined();
  });

  it('is visible with the module enabled and the permission granted', () => {
    const found = domain(['customer-portal'], ['customer-portal.links.manage']);
    expect(found).toBeDefined();
    expect(found?.sections.flatMap((s) => s.links).map((l) => l.href)).toContain('/customers');
  });
});

describe('Transport: Lieux link requires core.locations.read', () => {
  const transportLinks = (permissions: string[]) =>
    visibleDomains({ enabledModules: ['transportation'], can: (p) => permissions.includes(p) })
      .find((d) => d.key === 'transport')
      ?.sections.flatMap((s) => s.links)
      .map((l) => l.href) ?? [];

  it('hides /locations from Transport > Partenaires when core.locations.read is missing', () => {
    expect(transportLinks([])).not.toContain('/locations');
  });

  it('shows /locations from Transport > Partenaires with core.locations.read', () => {
    expect(transportLinks(['core.locations.read'])).toContain('/locations');
  });
});
