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
      'BookOpen',
      'PackageSearch',
      'ShoppingCart',
      'BriefcaseBusiness',
    ].map((name) => [name, () => null]),
  ),
);
import { visibleDomains, domainHome, navCatalogue, type NavDomain } from './navigation';
import { TOUR_MODULE_KEYS } from '@pulsar/shared';
import { knowledgeArticles, KNOWLEDGE_DETAILS, matchesKnowledge } from '$lib/help/knowledge';
import { MODULE_GUIDES } from '$lib/help/catalog';
import { TOUR_ROUTES } from '$lib/help/tours';

describe('Documented business applications', () => {
  it('SMS read opens Connect without unrelated integration or API-key access', () => {
    const domains = visibleDomains({ enabledModules: [], can: (p) => p === 'core.sms.read' });
    const connect = domains.find((d) => d.key === 'connect');
    expect(connect).toBeDefined();
    const links = connect!.sections.flatMap((s) => s.links).map((l) => l.href);
    expect(links).toContain('/connect/sms');
    expect(links).not.toContain('/integrations');
    expect(links).not.toContain('/settings/api-keys');
    expect(links).not.toContain('/connect/email');
  });
  it('every app has a guide, business rules and a first-entry tutorial', () => {
    for (const domain of navCatalogue()) {
      expect(MODULE_GUIDES[domain.key], domain.key).toBeDefined();
      expect(KNOWLEDGE_DETAILS[domain.key]?.rules.length, domain.key).toBeGreaterThan(1);
      expect(TOUR_ROUTES[domain.key]?.length, domain.key).toBeGreaterThan(0);
      expect(TOUR_MODULE_KEYS, domain.key).toContain(domain.key);
    }
  });
  it('documentation only contains accessible apps and links', () => {
    const articles = knowledgeArticles(
      visibleDomains({ enabledModules: ['services'], can: (p) => p === 'services.read' }),
    );
    expect(articles.map((a) => a.key)).toContain('services');
    expect(articles.map((a) => a.key)).toContain('documentation');
    expect(articles.map((a) => a.key)).not.toContain('catalog');
    expect(articles.map((a) => a.key)).not.toContain('purchasing');
  });
  it('search ignores accents and requires all terms', () => {
    const article = knowledgeArticles(navCatalogue()).find((a) => a.key === 'services')!;
    expect(matchesKnowledge(article, 'echeance projet')).toBe(true);
    expect(matchesKnowledge(article, 'compte rendu')).toBe(true);
    expect(matchesKnowledge(article, 'inexistant')).toBe(false);
  });
  it('new apps require both activation and read permission', () => {
    for (const key of ['catalog', 'purchasing', 'services']) {
      expect(
        visibleDomains({ enabledModules: [], can: () => true }).map((d) => d.key),
      ).not.toContain(key);
      expect(
        visibleDomains({ enabledModules: [key], can: () => false }).map((d) => d.key),
      ).not.toContain(key);
      expect(
        visibleDomains({ enabledModules: [key], can: (p) => p === key + '.read' }).map(
          (d) => d.key,
        ),
      ).toContain(key);
    }
  });
});

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
    expect(result).toContain('/fleet/register');
    expect(result).toContain('/fleet/maintenance');
    expect(result).toContain('/fleet/data');
  });
  it('shows the preserved registers to cross-module readers', () => {
    expect(
      links(['fleet', 'transportation'], ['fleet.read', 'transportation.master-data.read']),
    ).toContain('/fleet/register');
  });
  it('keeps registers accessible when TMS is disabled', () => {
    expect(links(['fleet'], ['fleet.read'])).toContain('/fleet/register');
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
    expect(found?.sections.flatMap((s) => s.links).map((l) => l.href)).toContain(
      '/customer-portal/data',
    );
  });
});

describe('domainHome', () => {
  it('returns domain.home when the user can see that link', () => {
    const domain = visibleDomains({
      enabledModules: ['customer-portal'],
      can: (p) => p === 'customer-portal.users.read',
    }).find((d) => d.key === 'customer-portal');
    expect(domain).toBeDefined();
    expect(domainHome(domain!)).toBe('/customer-portal/requests');
  });

  it('falls back to the first visible link when home is gated behind a permission the user lacks', () => {
    // customer-portal.links.manage sees its own data page, not the TMS customer page.
    // (/customer-portal/requests needs customer-portal.users.read) — this is
    // the exact case that used to 403 before domainHome existed.
    const domain = visibleDomains({
      enabledModules: ['customer-portal'],
      can: (p) => p === 'customer-portal.links.manage',
    }).find((d) => d.key === 'customer-portal');
    expect(domain).toBeDefined();
    const hrefs = domain!.sections.flatMap((s) => s.links).map((l) => l.href);
    expect(hrefs).not.toContain('/customer-portal/requests');
    expect(domainHome(domain!)).toBe(hrefs[0]);
    expect(domainHome(domain!)).toBe('/customer-portal/data');
  });

  it('falls back to domain.home when the user sees no links at all', () => {
    const domain: NavDomain = {
      key: 'empty',
      label: 'Empty',
      icon: (() => null) as unknown as NavDomain['icon'],
      home: '/empty',
      prefixes: ['/empty'],
      sections: [],
    };
    expect(domainHome(domain)).toBe('/empty');
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

describe('HR personal and management navigation', () => {
  it('gates manufacturing qualifications by both the minimal permission and HR activation', () => {
    const links = (enabledModules: string[], permissions: string[]) =>
      visibleDomains({ enabledModules, can: (p) => permissions.includes(p) }).flatMap((d) =>
        d.sections.flatMap((s) => s.links.map((l) => l.href)),
      );
    expect(
      links(['manufacturing'], ['manufacturing.read', 'hr.qualifications.read']),
    ).not.toContain('/manufacturing/qualifications');
    expect(links(['manufacturing', 'hr'], ['manufacturing.read'])).not.toContain(
      '/manufacturing/qualifications',
    );
    expect(
      links(['manufacturing', 'hr'], ['manufacturing.read', 'hr.qualifications.read']),
    ).toContain('/manufacturing/qualifications');
  });
  const hr = (enabledModules: string[], permissions: string[]) =>
    visibleDomains({ enabledModules, can: (p) => permissions.includes(p) }).find(
      (d) => d.key === 'hr',
    );
  it('shows the personal workspace without exposing management routes', () => {
    const domain = hr(['hr'], ['hr.self']);
    expect(domainHome(domain!)).toBe('/hr');
    expect(domain?.sections.flatMap((s) => s.links.map((l) => l.href))).toEqual([
      '/hr',
      '/hr/self',
    ]);
  });
  it('requires activation and an effective read scope', () => {
    expect(hr([], ['hr.read'])).toBeUndefined();
    expect(hr(['hr'], ['hr.approve'])).toBeUndefined();
    expect(hr(['hr'], ['hr.read'])?.sections.flatMap((s) => s.links.map((l) => l.href))).toEqual([
      '/hr',
      '/hr/employees',
      '/hr/teams',
      '/hr/skills',
      '/hr/qualifications',
      '/hr/leaves',
    ]);
  });
});
