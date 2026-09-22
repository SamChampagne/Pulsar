import { test, expect, type Page } from './fixtures';
import { login } from './helpers';
import type { YardDossierContext, YardDossierItem } from '@pulsar/shared';

async function setup(page: Page, url = '/yard') {
  await login(page);
  const site = {
    id: 'links-site',
    code: 'DC',
    name: 'Distribution Laurentienne',
    timezone: 'America/Toronto',
  };
  const visit = {
    id: 'links-visit',
    locationId: site.id,
    visitNumber: 'YV-482',
    status: 'ASSIGNED',
    direction: 'OTHER',
    spotId: 'q1',
    appointmentId: null,
    trailerRef: 'RF-482',
    trailer: null,
    carrier: { name: 'Transport Laurentien' },
    driverName: 'Alex',
    checkInAt: '2026-09-14T14:00:00Z',
    checkOutAt: null,
    notes: null,
    spot: { code: 'Q-01' },
    appointment: null,
    moves: [],
  };
  const appointment = {
    id: 'links-appointment',
    locationId: site.id,
    appointmentNumber: 'DA-482',
    status: 'COMPLETED',
    direction: 'OTHER',
    spotId: 'q1',
    carrierId: null,
    windowStart: '2026-09-14T14:00:00Z',
    windowEnd: '2026-09-14T16:00:00Z',
    reference: null,
    notes: null,
    carrier: null,
  };
  const workspace = {
    site,
    date: '2026-09-14',
    timeZone: 'America/Toronto',
    timezoneFallback: false,
    start: '2026-09-14T04:00:00Z',
    end: '2026-09-15T04:00:00Z',
    generatedAt: new Date().toISOString(),
    planVersion: 'a'.repeat(64),
    shapes: [],
    spots: [{ id: 'q1', code: 'Q-01', type: 'DOCK_DOOR', isActive: true, posX: 1, posY: 1 }],
    visits: [visit],
    appointments: [] as object[],
    truncated: { spots: false, visits: false, appointments: false },
  };
  const context: YardDossierContext = {
    source: {
      type: 'visit',
      id: visit.id,
      number: visit.visitNumber,
      locationId: site.id,
      sharedWithAppointment: false,
    },
    editable: true,
    groups: ['load', 'receipt', 'pick-order'].map((kind) => ({
      kind: kind as any,
      available: true,
      items: [],
      truncated: false,
    })),
  };
  const target: YardDossierItem = {
    id: 'linked-receipt',
    number: 'RC-482',
    status: 'DRAFT',
    href: '/wms/receiving/linked-receipt',
  };
  const load = {
    id: 'linked-load',
    loadNumber: 'LD-482',
    status: 'OPEN',
    mode: 'FTL',
    carrier: null,
    driver: null,
    vehicle: null,
    trailer: null,
    rate: null,
    shipments: [],
    route: null,
    accessorials: [],
    costDetail: null,
    estimatedCost: null,
    costCurrency: null,
  };
  await page.route('**/api/v1/yard/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace('/api/v1/yard/', '');
    if (r.request().method() !== 'GET')
      return r.fulfill({ status: 500, json: { message: 'Écriture non prévue dans ce scénario.' } });
    if (path === 'sites') return r.fulfill({ json: { items: [site], truncated: false } });
    if (path === 'workspace') return r.fulfill({ json: workspace });
    if (path === `visits/${visit.id}`) return r.fulfill({ json: visit });
    if (path === `appointments/${appointment.id}`) return r.fulfill({ json: appointment });
    if (path.startsWith('dossiers/related/'))
      return r.fulfill({
        json: {
          items: [
            {
              id: 'back',
              kind: 'visit',
              number: visit.visitNumber,
              status: visit.status,
              site: site.name,
              href: `/yard?site=${site.id}&visit=${visit.id}`,
            },
          ],
          truncated: false,
        },
      });
    if (path.endsWith('/candidates'))
      return r.fulfill({ json: { items: [target], truncated: false } });
    if (path.startsWith('dossiers/')) return r.fulfill({ json: context });
    return r.fulfill({ status: 404, json: { message: 'Introuvable' } });
  });
  await page.route('**/api/v1/wms/**', (r) => {
    if (r.request().method() !== 'GET')
      return r.fulfill({ status: 500, json: { message: 'Aucune mutation WMS dans ce test.' } });
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/wms/sites'))
      return r.fulfill({
        json: { items: [{ ...site, type: 'WAREHOUSE' }], total: 1, page: 1, pageSize: 100 },
      });
    if (path.endsWith('/receipts/linked-receipt'))
      return r.fulfill({
        json: {
          ...target,
          locationId: site.id,
          location: { ...site, type: 'WAREHOUSE' },
          createdAt: '2026-09-14T13:00:00Z',
          lines: [],
          _count: { lines: 0 },
        },
      });
    if (path.endsWith('/pick-orders/linked-pick'))
      return r.fulfill({
        json: {
          id: 'linked-pick',
          number: 'PK-482',
          status: 'OPEN',
          locationId: site.id,
          location: { ...site, type: 'WAREHOUSE' },
          createdAt: '2026-09-14T13:00:00Z',
          lines: [],
          _count: { lines: 0 },
        },
      });
    return r.fulfill({
      json: path.endsWith('/items') ? { items: [], total: 0, page: 1, pageSize: 100 } : [],
    });
  });
  await page.route('**/api/v1/transportation/locations?**', (r) =>
    r.fulfill({
      json: { items: [{ ...site, type: 'WAREHOUSE' }], total: 1, page: 1, pageSize: 100 },
    }),
  );
  await page.route('**/api/v1/transportation/loads/linked-load', (r) => r.fulfill({ json: load }));
  await page.route('**/api/v1/transportation/loads/linked-load/*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/transportation/tracking/events?**', (r) => r.fulfill({ json: [] }));
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Cour & quais', exact: true })).toBeVisible();
  return { context, target, visit, appointment, workspace };
}
async function panel(page: Page) {
  await page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-482', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Visite YV-482', exact: true });
  await expect(
    panel.getByRole('heading', { name: 'Dossiers opérationnels', exact: true }),
  ).toBeVisible();
  return panel;
}
test('legacy gate inherits the booked direction and resets an incompatible site selection', async ({
  page,
}) => {
  const { appointment, workspace } = await setup(page);
  const booked = { ...appointment, status: 'SCHEDULED', direction: 'OUTBOUND' };
  await page.route('**/api/v1/yard/appointments?**', (r) => r.fulfill({ json: [booked] }));
  await page.route('**/api/v1/yard/spots', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/yard/visits', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/yard/custom-fields?**', (r) => r.fulfill({ json: [] }));
  for (const entity of ['trailers', 'carriers'])
    await page.route(`**/api/v1/transportation/${entity}?**`, (r) =>
      r.fulfill({ json: { items: [], total: 0 } }),
    );
  await page.route('**/api/v1/locations?**', (r) =>
    r.fulfill({
      json: {
        items: [
          { ...workspace.site, type: 'WAREHOUSE' },
          { id: 'other-site', code: 'B', name: 'Autre site', type: 'WAREHOUSE' },
        ],
        total: 2,
      },
    }),
  );
  await page.goto('/yard/gate');
  await page
    .getByRole('combobox', { name: 'Rendez-vous (optionnel)', exact: true })
    .selectOption(booked.id);
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
    'OUTBOUND',
  );
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toBeDisabled();
  // Site is a search picker (entity picker), not a native select — open it and
  // choose the other warehouse from its option list.
  await page.getByRole('button', { name: /^Site :/ }).click();
  await page
    .getByRole('dialog', { name: 'Site', exact: true })
    .getByRole('option', { name: /Autre site/ })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Rendez-vous (optionnel)', exact: true }),
  ).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toBeEnabled();
});
test('link selection is explicit, cancellation sends nothing, and receipt navigation returns to the same visit', async ({
  page,
}) => {
  const { context, target } = await setup(page);
  let writes = 0;
  await page.route('**/api/v1/yard/dossiers/visit/links-visit/links', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({ kind: 'receipt', targetId: target.id });
    context.groups[1].items = [{ ...target, linkId: 'link-1' }];
    return r.fulfill({ json: { linkId: 'link-1', created: true } });
  });
  const drawer = await panel(page);
  await drawer.getByRole('button', { name: 'Relier un dossier', exact: true }).click();
  await drawer.getByLabel('Type de dossier').selectOption('receipt');
  await expect(drawer.getByLabel('Dossier à relier')).toBeVisible();
  await drawer.getByLabel('Dossier à relier').selectOption(target.id);
  await drawer.getByRole('button', { name: 'Relier le dossier', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Relier le dossier', exact: true });
  await expect(confirm).toContainText('ni le stock');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await expect(drawer.getByLabel('Dossier à relier')).toHaveValue(target.id);
  await drawer.getByRole('button', { name: 'Relier le dossier', exact: true }).click();
  await confirm.getByRole('button', { name: 'Relier', exact: true }).click();
  await drawer.getByRole('link', { name: 'RC-482 ↗', exact: true }).click();
  await expect(page).toHaveURL(/\/wms\/receiving\/linked-receipt$/);
  expect(writes).toBe(1);
  await page
    .getByRole('region', { name: 'Passages en cour liés' })
    .getByRole('link', { name: /YV-482/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Visite YV-482', exact: true })).toBeVisible();
});
test('a rejected link retains the selected record and query, and blocks drawer close while in flight', async ({
  page,
}) => {
  const { target } = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/v1/yard/dossiers/visit/links-visit/links', async (r) => {
    await pending;
    return r.fulfill({ status: 409, json: { message: 'Passage terminé par un autre opérateur.' } });
  });
  const drawer = await panel(page);
  await drawer.getByRole('button', { name: 'Relier un dossier', exact: true }).click();
  await drawer.getByLabel('Rechercher un dossier').fill('RC-482');
  await expect(drawer.getByLabel('Dossier à relier')).toBeVisible();
  await drawer.getByLabel('Dossier à relier').selectOption(target.id);
  await drawer.getByRole('button', { name: 'Relier le dossier', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Relier le dossier', exact: true })
    .getByRole('button', { name: 'Relier', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  release();
  await expect(drawer.getByRole('alert')).toContainText('Passage terminé');
  await expect(drawer.getByLabel('Dossier à relier')).toHaveValue(target.id);
  await expect(drawer.getByLabel('Rechercher un dossier')).toHaveValue('RC-482');
});
test('unlink confirms, retains the dossier after a failure, and never deletes the source record', async ({
  page,
}) => {
  const { context, target } = await setup(page);
  context.groups[1].items = [{ ...target, linkId: 'link-1' }];
  let writes = 0;
  await page.route('**/api/v1/yard/dossiers/visit/links-visit/links/link-1', (r) => {
    writes++;
    expect(r.request().method()).toBe('DELETE');
    return r.fulfill({ status: 409, json: { message: 'Association non retirée.' } });
  });
  const drawer = await panel(page);
  await drawer.getByRole('button', { name: 'Retirer le lien RC-482' }).click();
  const confirm = page.getByRole('dialog', { name: 'Retirer l’association', exact: true });
  await expect(confirm).toContainText('dossier est conservé');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await drawer.getByRole('button', { name: 'Retirer le lien RC-482' }).click();
  await confirm.getByRole('button', { name: 'Retirer', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('non retirée');
  await expect(drawer.getByRole('link', { name: 'RC-482 ↗', exact: true })).toBeVisible();
});
test('a failed context is not an empty linked list and restricted categories expose no target', async ({
  page,
}) => {
  const { context } = await setup(page);
  await page.route('**/api/v1/yard/dossiers/visit/links-visit', (r) =>
    r.fulfill({ status: 503, json: { message: 'Lecture indisponible.' } }),
  );
  const drawer = await panel(page);
  await expect(drawer.getByRole('alert')).toContainText('Dossiers non actualisés');
  await expect(drawer.getByRole('button', { name: 'Relier un dossier', exact: true })).toHaveCount(
    0,
  );
  await page.unroute('**/api/v1/yard/dossiers/visit/links-visit');
  context.editable = false;
  context.groups.forEach((g) => {
    g.available = false;
  });
  await drawer.getByRole('button', { name: /Réessayer/ }).click();
  await expect(
    drawer.getByText('Module ou droit de lecture indisponible.', { exact: true }),
  ).toHaveCount(3);
});
test('historical appointment links open their actual dossier even outside the current workspace list', async ({
  page,
}) => {
  const { context, target } = await setup(page);
  context.source = {
    ...context.source,
    type: 'appointment',
    id: 'links-appointment',
    number: 'DA-482',
    sharedWithAppointment: true,
  };
  context.editable = false;
  context.groups[1].items = [{ ...target, linkId: 'link-1' }];
  await page.goto('/yard?site=links-site&appointment=links-appointment&date=2026-09-14');
  const drawer = page.getByRole('dialog', { name: 'Rendez-vous DA-482', exact: true });
  await expect(drawer.getByRole('link', { name: 'RC-482 ↗', exact: true })).toBeVisible();
  await expect(drawer.getByText(/Liste partagée/)).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Relier un dossier', exact: true })).toHaveCount(
    0,
  );
});
test('late candidate responses cannot replace a newer search', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/v1/yard/dossiers/visit/links-visit/candidates?**', async (r) => {
    const q = new URL(r.request().url()).searchParams.get('q');
    if (q === 'OLD') await pending;
    return r.fulfill({
      json: {
        items: [{ id: q || 'initial', number: q || 'Initial', status: 'OPEN', href: '/loads/x' }],
        truncated: false,
      },
    });
  });
  const drawer = await panel(page);
  await drawer.getByRole('button', { name: 'Relier un dossier', exact: true }).click();
  const oldRequest = page.waitForRequest((r) => r.url().includes('q=OLD'));
  await drawer.getByLabel('Rechercher un dossier').fill('OLD');
  await oldRequest;
  await drawer.getByLabel('Rechercher un dossier').fill('NEW');
  await expect(drawer.getByRole('option', { name: 'NEW · Ouvert', exact: true })).toHaveCount(1);
  release();
  await expect(drawer.getByRole('option', { name: 'OLD · Ouvert', exact: true })).toHaveCount(0);
});
test('the connected panel remains contained at phone width', async ({ page }) => {
  const { context, target } = await setup(page);
  context.groups[1].items = [{ ...target, linkId: 'link-1' }];
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = await panel(page);
  await drawer
    .getByRole('heading', { name: 'Dossiers opérationnels', exact: true })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/yard-dossiers-mobile.png', fullPage: true });
});
for (const route of ['/loads/linked-load', '/wms/picking/linked-pick'])
  test(`reverse navigation is present on ${route}`, async ({ page }) => {
    await setup(page);
    await page.goto(route);
    await expect(
      page
        .getByRole('region', { name: 'Passages en cour liés' })
        .getByRole('link', { name: /YV-482/ }),
    ).toBeVisible();
  });
