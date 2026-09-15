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
