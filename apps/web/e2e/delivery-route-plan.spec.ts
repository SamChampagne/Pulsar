import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';
import { buildDeliveryPlan } from '@pulsar/shared';

// End the SPA while mocks are installed, so late tracking reloads cannot reach a real API.
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

async function setup(page: Page, manage = true) {
  await page.addInitScript(
    ({ manage }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture',
          refreshToken: 'fixture',
          user: {
            id: 'operator',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: [
              'transportation.planning.read',
              'transportation.execution.read',
              ...(manage
                ? ['transportation.planning.manage', 'transportation.execution.manage']
                : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Composants du Nord',
            slug: 'fixture',
            enabledModules: ['transportation'],
          },
        }),
      ),
    { manage },
  );
  const version = '2026-10-01T12:00:00.000Z';
  const writes: { path: string; body: any }[] = [];
  const state = { conflict: false, route: null as any };
  const locations = [
    { id: 'a', name: 'Atelier Laval', city: 'Laval', latitude: 45.6, longitude: -73.7 },
    { id: 'b', name: 'Usine Québec', city: 'Québec', latitude: 46.8, longitude: -71.2 },
  ];
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/v1/transportation/accessorials')
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
    if (path === '/api/v1/transportation/loads/fixture')
      return route.fulfill({
        json: {
          id: 'fixture',
          loadNumber: 'LD-RECETTE',
          updatedAt: version,
          status: 'OPEN',
          carrier: null,
          driver: null,
          vehicle: null,
          trailer: null,
          rate: null,
          mode: 'FTL',
          notes: null,
          estimatedCost: null,
          costDetail: null,
          costCurrency: null,
          accessorials: [],
          route: state.route ? { id: 'route' } : null,
          shipments: [
            {
              id: 's',
              shipmentNumber: 'SH-COMPOSANTS',
              status: 'PLANNED',
              transportOrderId: 'order',
              originLocationId: 'a',
              destinationLocationId: 'b',
              proofOfDelivery: null,
            },
          ],
        },
      });
    if (path === '/api/v1/transportation/routes/route') return route.fulfill({ json: state.route });
    if (path === '/api/v1/transportation/routes/preview') {
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: { message: 'Le chargement a changé. Rechargez avant de planifier.' },
        });
      const dto = req.postDataJSON();
      const legs = [{ distanceKm: 100, durationMin: 60, source: 'OSRM' as const }];
      if (dto.planning.returnToStart)
        legs.push({ distanceKm: 100, durationMin: 60, source: 'OSRM' });
      return route.fulfill({
        json: {
          deliveryPlan: buildDeliveryPlan(dto.stops, legs, dto.planning),
          stops: dto.stops,
          expectedUpdatedAt: version,
          labels: { a: 'Atelier Laval', b: 'Usine Québec' },
          locations,
          geometry: null,
          optimization: dto.optimize
            ? 'Aucun ordre meilleur trouvé. Ordre actuel conservé.'
            : 'Ordre saisi conservé.',
          savedDistanceKm: 0,
        },
      });
    }
    if (path === '/api/v1/transportation/routes' && req.method() === 'POST') {
      const dto = req.postDataJSON();
      state.route = {
        id: 'route',
        distanceSource: 'OSRM',
        totalDistanceKm: 100,
        estimatedDurationMin: 60,
        geometry: null,
        deliveryPlan: buildDeliveryPlan(
          dto.stops,
          [{ distanceKm: 100, durationMin: 60, source: 'OSRM' }],
          dto.planning,
        ),
        stops: dto.stops.map((s: any, i: number) => ({
          ...s,
          id: `stop-${i}`,
          status: 'PENDING',
          location: locations.find((l) => l.id === s.locationId),
        })),
      };
      return route.fulfill({ json: state.route });
    }
    if (await fulfillUnmockedDeliveryPanel(route)) return;
    return route.fulfill({
      json: path.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : path.endsWith('/unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  await page.goto('/loads/fixture');
  await expect(page.getByRole('heading', { name: 'Tournée et carburant' })).toBeVisible();
  return { writes, state };
}
test('fuel preview stays separate from save and invalidates on edits', async ({ page }, info) => {
  const { writes } = await setup(page);
  await page.getByRole('button', { name: 'Préparer la tournée' }).click();
  await page.getByLabel('Début au premier arrêt', { exact: true }).fill('2026-10-02T08:00');
  await page.getByLabel('Consommation chargé (L/100 km)', { exact: true }).fill('30');
  await page.getByLabel('Prix du carburant par litre', { exact: true }).fill('1.6');
  await page.getByRole('button', { name: 'Calculer cet ordre', exact: true }).click();
  await expect(page.locator('input:invalid')).toHaveCount(0);
  await expect(page.getByText('48.00 CAD', { exact: true })).toBeVisible();
  expect(writes.filter((w) => w.path.endsWith('/routes'))).toHaveLength(0);
  await page.getByLabel('Prix du carburant par litre', { exact: true }).fill('1.7');
  await expect(
    page.getByRole('button', { name: 'Confirmer et enregistrer la tournée' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Calculer cet ordre', exact: true }).click();
  await expect(page.getByText('51.00 CAD', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Horaire prévisionnel par arrêt' }),
  ).not.toContainText('Non calculé');
  await page.getByRole('region', { name: 'Prévision de livraison' }).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
    let parent = el.parentElement;
    while (parent) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) {
        parent.scrollTop = Math.max(0, parent.scrollTop - 90);
        break;
      }
      parent = parent.parentElement;
    }
  });
  await page.screenshot({ path: info.outputPath('delivery-desktop.png'), fullPage: false });
  await page.getByRole('button', { name: 'Confirmer et enregistrer la tournée' }).click();
  await expect(page.getByRole('heading', { name: 'Exécution des livraisons' })).toBeVisible();
  expect(writes.filter((w) => w.path.endsWith('/routes'))).toHaveLength(1);
  expect(writes.find((w) => w.path.endsWith('/routes'))?.body.expectedUpdatedAt).toBe(
    '2026-10-01T12:00:00.000Z',
  );
});
test('stale load is explicit and cannot be silently saved', async ({ page }) => {
  const { state, writes } = await setup(page);
  state.conflict = true;
  await page.getByRole('button', { name: 'Préparer la tournée' }).click();
  await page.getByRole('button', { name: 'Proposer un meilleur ordre' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Le chargement a changé' })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body.optimize).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Confirmer et enregistrer la tournée' }),
  ).toHaveCount(0);
});
test('read-only planner has no mutation controls', async ({ page }) => {
  const { writes } = await setup(page, false);
  await expect(page.getByRole('button', { name: 'Préparer la tournée' })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
test('mobile planning keeps labels and controls within the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: 'Préparer la tournée' }).click();
  await expect(page.getByLabel('Consommation chargé (L/100 km)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('delivery-mobile.png'), fullPage: true });
});
