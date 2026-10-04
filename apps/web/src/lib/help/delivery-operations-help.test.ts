import { describe, expect, it, vi } from 'vitest';
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
      'BookOpen',
      'PackageSearch',
      'ShoppingCart',
      'BriefcaseBusiness',
    ].map((name) => [name, () => null]),
  ),
);
import { visibleDomains } from '$lib/modules/navigation';
import { PAGE_GUIDES } from './catalog';
import { MODULE_LESSONS } from './module-lessons';
import { TOUR_ROUTES, shouldStartTour } from './tours';

describe('delivery operations help and navigation', () => {
  it('requires Transportation and planning.read for the cockpit link', () => {
    const links = (modules: string[], permissions: string[]) =>
      visibleDomains({ enabledModules: modules, can: (p) => permissions.includes(p) })
        .flatMap((d) => d.sections.flatMap((s) => s.links))
        .map((l) => l.href);
    expect(links(['transportation'], ['transportation.planning.read'])).toContain(
      '/delivery-operations',
    );
    expect(links([], ['transportation.planning.read'])).not.toContain('/delivery-operations');
    expect(links(['transportation'], ['transportation.execution.read'])).not.toContain(
      '/delivery-operations',
    );
  });
  it('documents source attestation and distinguishes return from stock or refund', () => {
    expect(PAGE_GUIDES['/delivery-operations'].steps.join(' ')).toContain(
      'attestation humaine 1:1',
    );
    expect(PAGE_GUIDES['/delivery-operations'].caution).toContain(
      'ne crée ni stock, ni remboursement',
    );
    expect(
      MODULE_LESSONS.transport.find((lesson) => lesson.href === '/delivery-operations')?.target,
    ).toBe('[data-tour="delivery-workspace"]');
    expect(TOUR_ROUTES.transport).toContain('/delivery-operations');
  });
  it('does not reset first-entry progress after adding the new lesson', () => {
    expect(shouldStartTour({ version: 1, step: 0, status: 'COMPLETED' })).toBe(false);
    expect(shouldStartTour()).toBe(true);
  });
});
